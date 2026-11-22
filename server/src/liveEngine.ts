/**
 * Simultaneous caption engine: re-translate the open line, freeze on silence/sentence,
 * one in-flight request per language (cancel stale), LLM revise off the hot path.
 */
import { isHallucination, stripRepeats } from "./asrFilter.js";
import {
  detectBibleRefs,
  fetchCanonicalVerse,
  looksLikeVerseReading,
} from "./bibleRefs.js";
import { writeLog } from "./boot.js";
import { correctAsrTerms, polishChurchTerms } from "./churchGlossary.js";
import { translateNllb } from "./nllbTranslate.js";
import { rivaCanPivot, translateRiva } from "./rivaTranslate.js";
import { clearSermonCard, refreshSermonCard } from "./sermonMemory.js";
import { StableText } from "./stableCaption.js";
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

/** Only punctuation or capitals changed: same words, same order. */
export function sameWords(a: string, b: string) {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  return norm(a) === norm(b);
}

/** Pause with no newer translation before the open line is shown whole. */
const SETTLE_MS = 450;

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

/** One caption line into a listener language. Skips a result that is still the source. */
async function translateHistorical(text: string, source: LanguageCode, target: LanguageCode) {
  let out: string | null = null;
  if (rivaCanPivot(source, target)) out = await translateRiva(text, source, target);
  if (!out) {
    const many = await translateMany(text, source, [target]);
    out = many[target] ?? null;
  }
  const trimmed = out?.trim() ?? "";
  if (!trimmed || trimmed === text.trim()) return null;
  return trimmed;
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
  /** Per language display stabilizer for the current live line. */
  private stable = new Map<LanguageCode, StableText>();
  private stableLineId = "";
  private settleTimers = new Map<LanguageCode, ReturnType<typeof setTimeout>>();
  /** The last frozen block was cut at a clause break: the next one continues it. */
  private clauseOpen = false;

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

  /** WhisperLiveKit: only new committed words plus the current tip. */
  pushCommitted(committed: string, tip: string) {
    if (this.closed) return;
    const heard = [committed.trim(), tip.trim()].filter(Boolean).join(" | ");
    if (heard && heard !== this.lastLoggedHeard) {
      this.lastLoggedHeard = heard;
      writeLog(`[ouviu] ${heard}`);
    }
    const snap = getSourceTape(this.code).pushCommitted(committed, tip);
    this.handleSnapshot(snap);
    this.armSilence();
  }

  stop() {
    const tape = getSourceTape(this.code);
    const snap = tape.flushAll();
    this.handleSnapshot(snap);
    this.clearSilence();
  }

  /** Listener switched language: translate the line that is still open. */
  retarget() {
    if (this.closed) return;
    const open = (this.liveOriginal || getSourceTape(this.code).getOpenText()).trim();
    if (!open) return;
    this.scheduleTranslate(open, false);
  }

  clear() {
    this.closed = true;
    this.clearSilence();
    if (this.memoryTimer) clearTimeout(this.memoryTimer);
    this.memoryTimer = null;
    if (this.translateTimer) clearTimeout(this.translateTimer);
    this.translateTimer = null;
    this.queuedText = "";
    this.clearSettle();
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

    if (snap.open.trim() && isHallucination(snap.open, this.hooks.getSourceLang())) {
      return; // never show hallucinated text on the live line
    }
    if (snap.open.trim()) {
      // Church vocabulary fixed once, so the source shown and translated agree.
      const lang = this.hooks.getSourceLang();
      const open = correctAsrTerms(stripRepeats(snap.open), lang);
      this.liveOriginal = open;
      if (snap.openChanged || !this.liveId) {
        if (!this.liveId) this.liveId = makeId(`live-${this.code}`);
        this.emitLiveShell(open);
        this.scheduleTranslate(snap.openStable ? correctAsrTerms(stripRepeats(snap.openStable), lang) : open, false);
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

    this.clearSettle(target);
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
        // Show only words two translations agree on; words already read never jump.
        const polished = polishChurchTerms(translated, target);
        const stable = this.stableFor(target);
        const quiet = getSourceTape(this.code).msSinceLastInput() >= SETTLE_MS;
        // Speech already paused (or the listener just switched language): show it whole.
        const publish = !current.nextText && quiet ? stable.settle(polished) : stable.update(polished);
        if (!current.nextText && !quiet) this.armSettle(target, source, original, polished);
        this.logPair("ao vivo", target, original, publish);
        if (publish) this.publishLiveLang(target, source, original, publish, false);
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

  /**
   * Nothing newer to translate for a moment: the speaker paused mid-sentence.
   * The newest translation covers everything heard, so show it whole.
   */
  private armSettle(target: LanguageCode, source: LanguageCode, original: string, hypothesis: string) {
    this.clearSettle(target);
    const lineId = this.liveId;
    this.settleTimers.set(
      target,
      setTimeout(() => {
        this.settleTimers.delete(target);
        if (this.closed || this.liveId !== lineId || this.flights.has(target)) return;
        const stable = this.stableFor(target);
        const before = stable.current();
        const shown = stable.settle(hypothesis);
        if (shown && shown !== before) {
          this.logPair("ao vivo", target, original, shown);
          this.publishLiveLang(target, source, original, shown, false);
        }
      }, SETTLE_MS),
    );
  }

  private clearSettle(target?: LanguageCode) {
    const targets = target ? [target] : [...this.settleTimers.keys()];
    for (const lang of targets) {
      const timer = this.settleTimers.get(lang);
      if (timer) clearTimeout(timer);
      this.settleTimers.delete(lang);
    }
  }

  private stableFor(target: LanguageCode) {
    if (this.stableLineId !== this.liveId) {
      this.stable.clear();
      this.stableLineId = this.liveId;
    }
    let text = this.stable.get(target);
    if (!text) {
      text = new StableText();
      this.stable.set(target, text);
    }
    return text;
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
    const raw = correctAsrTerms(stripRepeats(phrase.trim()), this.hooks.getSourceLang());
    if (isHallucination(raw, this.hooks.getSourceLang())) {
      writeLog(`[descartado] ${phrase.trim().slice(0, 120)}`);
      return;
    }
    const original = finishSentence(raw, this.clauseOpen);
    if (!original) return;
    this.clauseOpen = /[,;:]$/.test(raw);

    const source = this.hooks.getSourceLang();
    const targets = this.hooks.getTargets().filter((l) => l !== source);
    const id = makeId(`c-${this.code}`);
    this.liveId = makeId(`live-${this.code}`);
    this.liveOriginal = "";

    // Drop queued live requests — this sentence gets its own translation.
    this.clearSettle();
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

    const late = this.hooks.getTargets().filter((lang) => lang !== source && !translations[lang]);
    if (late.length) {
      const extra = await Promise.all(
        late.map(async (lang) => [lang, await translateHistorical(original, source, lang)] as const),
      );
      for (const [lang, text] of extra) {
        if (text) translations[lang] = polishChurchTerms(text, lang);
      }
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
    // The listener may already have read this line: accept punctuation and
    // capitals only. A model that drops, adds or swaps words is ignored.
    const nextSource = shaped[source];
    if (nextSource && nextSource !== caption.original && sameWords(nextSource, caption.original)) {
      caption.original = nextSource;
      caption.translations[source] = nextSource;
      changed = true;
    }
    for (const target of targets) {
      const next = shaped[target];
      const before = caption.translations[target] ?? "";
      if (next && next !== before && sameWords(next, before)) {
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

/** Fill missing languages on historical finals when a listener joins or switches language. */
export async function fillMissingLanguages(
  captions: Caption[],
  source: LanguageCode,
  langs: LanguageCode[],
  limit = 80,
) {
  const targets = langs.filter((l) => l !== source);
  if (!targets.length) return [];
  const updated: Caption[] = [];
  const recent = captions.filter((c) => c.isFinal).slice(-limit);
  await Promise.all(
    recent.map(async (caption) => {
      const missing = targets.filter((lang) => !caption.translations[lang]?.trim());
      if (!missing.length) return;
      let touched = false;
      await Promise.all(
        missing.map(async (lang) => {
          const out = await translateHistorical(caption.original, source, lang);
          if (!out) return;
          caption.translations[lang] = out;
          touched = true;
        }),
      );
      if (touched) updated.push(caption);
    }),
  );
  return updated;
}
