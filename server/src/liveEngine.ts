/**
 * Simultaneous caption engine: re-translate the open line, freeze on silence/sentence,
 * one in-flight request per language (cancel stale), LLM revise off the hot path.
 */
import {
  detectBibleRefs,
  fetchCanonicalVerse,
  looksLikeVerseReading,
} from "./bibleRefs.js";
import { writeLog } from "./boot.js";
import { polishChurchTerms } from "./churchGlossary.js";
import { translateNllb } from "./nllbTranslate.js";
import { rivaCanPivot, translateRiva } from "./rivaTranslate.js";
import { clearSermonCard, refreshSermonCard } from "./sermonMemory.js";
import {
  clearSourceTape,
  getSourceTape,
  silenceNeeded,
  type TapePushResult,
} from "./sourceTape.js";
import {
  finishSentence,
  shapeSentencesWithLlm,
  translateGoogleDraft,
  translateMany,
} from "./translate.js";
import type { Caption, LanguageCode } from "./types.js";

export type LiveEngineHooks = {
  getSourceLang: () => LanguageCode;
  getTargets: () => LanguageCode[];
  onLive: (caption: Caption) => void;
  onUpdate: (caption: Caption) => void;
  onFinal: (caption: Caption) => void;
};

type LangFlight = {
  controller: AbortController;
  generation: number;
  /** Source text this request was started with. */
  text: string;
  /** Newest source text to translate after this request finishes. */
  nextText: string | null;
};

type EnglishPivot = {
  source: string;
  english: string;
};

/** Hide last tip words until freeze (flicker control). */
function displayTranslation(text: string, frozen: boolean) {
  if (frozen) return text.trim();
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return words.join(" ");
  return words.slice(0, -2).join(" ");
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Persian/Urdu and any pair Riva did not cover. Google only if NLLB is down. */
async function localOrGoogle(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
) {
  const local = await translateNllb(text, source, target);
  if (local) return local;
  return translateGoogleDraft(text, source, target);
}

export class LiveEngine {
  private readonly code: string;
  private readonly hooks: LiveEngineHooks;
  private liveId = "";
  private liveOriginal = "";
  private flights = new Map<LanguageCode, LangFlight>();
  private generations = new Map<LanguageCode, number>();
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private memoryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** English pivot only for the source sentence that produced it. */
  private pivot: EnglishPivot | null = null;
  private translateTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedText = "";
  private lastLoggedHeard = "";
  private lastLoggedLive = new Map<LanguageCode, string>();

  constructor(code: string, hooks: LiveEngineHooks) {
    this.code = code;
    this.hooks = hooks;
    this.liveId = makeId(`live-${code}`);
    this.armMemory();
  }

  push(text: string, isFinal: boolean) {
    if (this.closed) return;
    const heard = text.trim();
    if (heard && heard !== this.lastLoggedHeard) {
      this.lastLoggedHeard = heard;
      writeLog(`[ouviu${isFinal ? " fim" : ""}] ${heard}`);
    }
    const tape = getSourceTape(this.code);
    const snap = tape.push(text, isFinal);
    this.handleSnapshot(snap);
    this.armSilence();
  }

  stop() {
    const tape = getSourceTape(this.code);
    const snap = tape.flushAll();
    this.handleSnapshot(snap);
    this.clearSilence();
  }

  clear() {
    this.closed = true;
    this.clearSilence();
    if (this.memoryTimer) clearTimeout(this.memoryTimer);
    this.memoryTimer = null;
    if (this.translateTimer) clearTimeout(this.translateTimer);
    this.translateTimer = null;
    this.queuedText = "";
    this.lastLoggedHeard = "";
    this.lastLoggedLive.clear();
    for (const flight of this.flights.values()) {
      flight.nextText = null;
      flight.controller.abort();
    }
    this.flights.clear();
    clearSourceTape(this.code);
    clearSermonCard(this.code);
  }

  private handleSnapshot(snap: TapePushResult) {
    for (const phrase of snap.frozen) {
      void this.freezePhrase(phrase);
    }

    if (snap.open.trim()) {
      this.liveOriginal = snap.open;
      if (snap.openChanged || !this.liveId) {
        if (!this.liveId) this.liveId = makeId(`live-${this.code}`);
        this.emitLiveShell(snap.open);
        this.scheduleTranslate(snap.openStable || snap.open, false);
      }
    } else if (snap.frozeOpen) {
      this.liveOriginal = "";
      this.liveId = makeId(`live-${this.code}`);
    }
  }

  private emitLiveShell(original: string) {
    const source = this.hooks.getSourceLang();
    const caption: Caption = {
      id: this.liveId,
      original,
      translated: original,
      translations: { [source]: original },
      isFinal: false,
      at: Date.now(),
      live: true,
    };
    this.hooks.onLive(caption);
  }

  private armSilence() {
    this.clearSilence();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.closed) return;
      const snap = getSourceTape(this.code).freezeSilence();
      this.handleSnapshot(snap);
    }, silenceNeeded(getSourceTape(this.code).getOpenText()) + 40);
  }

  private clearSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private armMemory() {
    if (this.memoryTimer) clearTimeout(this.memoryTimer);
    this.memoryTimer = setTimeout(() => {
      this.memoryTimer = null;
      if (this.closed) return;
      void this.refreshMemory().finally(() => {
        if (!this.closed) this.armMemory();
      });
    }, 25_000);
  }

  private async refreshMemory() {
    const recent = getSourceTape(this.code).getConfirmedText();
    await refreshSermonCard(this.code, recent, this.hooks.getSourceLang());
  }

  private scheduleTranslate(sourceText: string, _frozen: boolean) {
    const text = sourceText.trim();
    if (!text) return;
    this.queuedText = text;
    if (this.translateTimer) return;
    this.translateTimer = setTimeout(() => {
      this.translateTimer = null;
      if (this.closed) return;
      const latest = this.queuedText.trim();
      if (!latest) return;
      const source = this.hooks.getSourceLang();
      for (const target of this.uniqueTargets(source)) {
        if (target === source) continue;
        this.startFlight(latest, source, target);
      }
    }, 280);
  }

  private uniqueTargets(source: LanguageCode) {
    const set = new Set(this.hooks.getTargets());
    set.add(source);
    return [...set];
  }

  private startFlight(text: string, source: LanguageCode, target: LanguageCode) {
    const current = this.flights.get(target);
    if (current) {
      if (current.text !== text) current.nextText = text;
      return;
    }

    const generation = (this.generations.get(target) ?? 0) + 1;
    this.generations.set(target, generation);
    const flight: LangFlight = {
      controller: new AbortController(),
      generation,
      text,
      nextText: null,
    };
    this.flights.set(target, flight);
    void this.runFlight(flight, source, target);
  }

  private async translateLine(
    text: string,
    source: LanguageCode,
    target: LanguageCode,
    signal: AbortSignal,
  ) {
    if (source === target) return text;

    let translated: string | null = null;
    if (rivaCanPivot(source, target)) {
      translated = await translateRiva(text, source, target, signal);
      if (source === "pt" && target === "en" && translated) {
        this.pivot = { source: text, english: translated };
      }
    }

    // Pivot es/it only through English that came from THIS sentence.
    if (signal.aborted) return null;
    if (
      !translated &&
      source === "pt" &&
      (target === "es" || target === "it") &&
      this.pivot?.source === text
    ) {
      translated = await translateRiva(this.pivot.english, "en", target, signal);
    }

    if (signal.aborted) return null;
    if (!translated) translated = await localOrGoogle(text, source, target);
    return translated;
  }

  private async runFlight(flight: LangFlight, source: LanguageCode, target: LanguageCode) {
    const { generation, controller } = flight;
    try {
      const translated = await this.translateLine(flight.text, source, target, controller.signal);
      if (controller.signal.aborted || this.closed) return;
      if (this.generations.get(target) !== generation) return;
      const current = this.flights.get(target);
      if (!current || current.generation !== generation) return;

      const original = this.liveOriginal || flight.text;
      const stillRelevant =
        !current.nextText ||
        original.toLowerCase().includes(flight.text.toLowerCase()) ||
        flight.text.toLowerCase().startsWith(original.toLowerCase());

      if (translated && stillRelevant) {
        const publish = displayTranslation(polishChurchTerms(translated, target), false);
        this.logPair("ao vivo", target, original, publish);
        this.publishLiveLang(target, source, original, publish, false);
      } else if (!translated && source !== target) {
        // Drop a previous sentence's translation instead of leaving it on screen.
        this.publishLiveLang(target, source, original, "", false);
      }
    } catch {
      /* aborted or network — the queued text is translated next */
    } finally {
      const current = this.flights.get(target);
      const chain = current === flight ? flight.nextText : null;
      if (current === flight) this.flights.delete(target);
      if (chain && chain !== flight.text && !this.closed && !controller.signal.aborted) {
        this.startFlight(chain, source, target);
      }
    }
  }

  private logPair(kind: "ao vivo", target: LanguageCode, original: string, translated: string) {
    const line = `${original} → ${translated || "(sem tradução)"}`;
    if (this.lastLoggedLive.get(target) === line) return;
    this.lastLoggedLive.set(target, line);
    writeLog(`[tradução ${target} ${kind}] ${line}`);
  }

  private publishLiveLang(
    target: LanguageCode,
    source: LanguageCode,
    original: string,
    translated: string,
    frozen: boolean,
  ) {
    if (frozen) return; // finals go through freezePhrase

    const caption: Caption = {
      id: this.liveId,
      original,
      translated,
      translations: {
        [source]: original,
        [target]: translated,
      },
      isFinal: false,
      at: Date.now(),
      live: true,
    };
    this.hooks.onLive(caption);
  }

  private async freezePhrase(phrase: string) {
    const original = finishSentence(phrase.trim());
    if (!original) return;

    const source = this.hooks.getSourceLang();
    const targets = this.hooks.getTargets().filter((l) => l !== source);
    const id = makeId(`c-${this.code}`);
    this.liveId = makeId(`live-${this.code}`);
    this.liveOriginal = "";

    // Drop queued live requests — this sentence gets its own translation.
    if (this.translateTimer) clearTimeout(this.translateTimer);
    this.translateTimer = null;
    this.queuedText = "";
    for (const flight of this.flights.values()) {
      flight.nextText = null;
      flight.controller.abort();
    }
    this.flights.clear();

    const translations: Caption["translations"] = { [source]: original };

    // English only from this sentence. Never reuse the previous caption.
    let english: string | null = this.pivot?.source === original ? this.pivot.english : null;
    if (source === "pt" && (targets.includes("en") || targets.includes("es") || targets.includes("it"))) {
      const fresh = await translateRiva(original, "pt", "en");
      if (fresh) {
        english = fresh;
        this.pivot = { source: original, english: fresh };
      } else if (!english) {
        english = await localOrGoogle(original, source, "en");
      }
      if (english && targets.includes("en")) translations.en = polishChurchTerms(english, "en");
    }

    const settled = await Promise.all(
      targets
        .filter((target) => target !== "en" || !translations.en)
        .map(async (target) => {
          let out: string | null = null;
          if (english && (target === "es" || target === "it")) {
            out = await translateRiva(english, "en", target);
          }
          if (!out && rivaCanPivot(source, target)) {
            out = await translateRiva(original, source, target);
          }
          if (!out) out = await localOrGoogle(original, source, target);
          if (!out) out = original;
          return [target, polishChurchTerms(out, target)] as const;
        }),
    );
    for (const [lang, text] of settled) {
      translations[lang] = text;
    }

    const hits = detectBibleRefs(original);
    let bibleRef: string | undefined;
    if (hits[0]) {
      bibleRef = hits[0].ref;
      if (looksLikeVerseReading(original, hits[0])) {
        for (const lang of [source, ...targets]) {
          const verse = await fetchCanonicalVerse(hits[0], lang);
          if (verse) translations[lang] = verse;
        }
      }
    }

    const preferred =
      translations.en ||
      Object.values(translations).find((v) => v && v !== original) ||
      original;

    const caption: Caption = {
      id,
      original,
      translated: preferred,
      translations,
      isFinal: true,
      at: Date.now(),
      live: false,
      bibleRef,
    };
    for (const [lang, text] of Object.entries(translations)) {
      if (lang === source || !text) continue;
      writeLog(`[tradução ${lang}] ${original} → ${text}`);
    }
    this.hooks.onFinal(caption);
    void this.shapeFinal(caption, source, targets);
  }

  /** Same caption, in place: the language model adds punctuation and sentence shape. */
  private async shapeFinal(caption: Caption, source: LanguageCode, targets: LanguageCode[]) {
    const drafts: Partial<Record<LanguageCode, string>> = {
      [source]: caption.original,
    };
    for (const target of targets) {
      const draft = caption.translations[target];
      if (draft) drafts[target] = draft;
    }
    const shaped = await shapeSentencesWithLlm({ source, drafts });
    if (!shaped) return;

    let changed = false;
    const nextSource = shaped[source];
    if (nextSource && nextSource !== caption.original) {
      caption.original = nextSource;
      caption.translations[source] = nextSource;
      changed = true;
    }
    for (const target of targets) {
      const next = shaped[target];
      if (next && next !== caption.translations[target]) {
        caption.translations[target] = next;
        changed = true;
      }
    }
    if (!changed) return;
    caption.translated =
      caption.translations.en ||
      Object.values(caption.translations).find(Boolean) ||
      caption.translated;
    caption.at = Date.now();
    writeLog(`[frase] ${caption.original}`);
    this.hooks.onUpdate(caption);
  }
}

const engines = new Map<string, LiveEngine>();

export function ensureLiveEngine(code: string, hooks: LiveEngineHooks): LiveEngine {
  const existing = engines.get(code);
  if (existing) return existing;
  const created = new LiveEngine(code, hooks);
  engines.set(code, created);
  return created;
}

export function getLiveEngine(code: string) {
  return engines.get(code);
}

export function clearLiveEngine(code: string) {
  engines.get(code)?.clear();
  engines.delete(code);
}

/** Fill missing languages on historical finals when a new listener joins. */
export async function fillMissingLanguages(
  captions: Caption[],
  source: LanguageCode,
  langs: LanguageCode[],
  limit = 80,
) {
  const targets = langs.filter((l) => l !== source);
  if (!targets.length) return false;
  let changed = false;
  const recent = captions.filter((c) => c.isFinal).slice(-limit);
  await Promise.all(
    recent.map(async (caption) => {
      const missing = targets.filter((lang) => !caption.translations[lang]);
      if (!missing.length) return;
      const viaRiva: LanguageCode[] = [];
      const viaGoogle: LanguageCode[] = [];
      for (const lang of missing) {
        if (rivaCanPivot(source, lang)) viaRiva.push(lang);
        else viaGoogle.push(lang);
      }
      await Promise.all(
        viaRiva.map(async (lang) => {
          const out = await translateRiva(caption.original, source, lang);
          if (out) {
            caption.translations[lang] = out;
            changed = true;
          }
        }),
      );
      if (viaGoogle.length) {
        Object.assign(
          caption.translations,
          await translateMany(caption.original, source, viaGoogle),
        );
        changed = true;
      }
    }),
  );
  return changed;
}
