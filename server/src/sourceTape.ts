/**
 * Streaming source tape: confirmed ASR words never leave.
 * Interim hypotheses only rewrite the unstable tip.
 */

/** Pause that closes a sentence. A short breath must not start a new line. */
export const FREEZE_SILENCE_MS = 2_200;
/** A long open line can close a little sooner, still only after a real pause. */
export const FREEZE_LONG_LINE_MS = 1_200;
const LONG_LINE_WORDS = 32;
/** Continuous speech with no pause still becomes one paragraph, not an endless line. */
const MAX_OPEN_WORDS = 46;
/** A long committed sentence closes at its last clause break (comma, semicolon, colon). */
const CLAUSE_SPLIT_WORDS = 28;
const MIN_CLAUSE_WORDS = 10;
const CLAUSE_END = /[,;:]$/;

export function silenceNeeded(openText: string) {
  const words = openText.trim().split(/\s+/).filter(Boolean).length;
  return words >= LONG_LINE_WORDS ? FREEZE_LONG_LINE_MS : FREEZE_SILENCE_MS;
}
const TIP_WORDS = 2;
const END_SENTENCE = /[.?!…]$/;

export type TapePushResult = {
  /** Full confirmed speech this session (bounded). */
  confirmed: string;
  /** Current open phrase (confirmed-open + tip). */
  open: string;
  /** Open phrase without the unstable tip — safer to translate. */
  openStable: string;
  /** Tip that may still change. */
  tip: string;
  /** Phrases frozen since this push (sentence end or silence). */
  frozen: string[];
  /** Open text changed — retranslate. */
  openChanged: boolean;
  /** Open phrase just closed. */
  frozeOpen: boolean;
};

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function wordsOf(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

function bare(word: string) {
  return word.toLowerCase().replace(/[.,;:!?…]+$/g, "");
}

function joinWords(parts: string[]) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Longest matching word prefix length (case-insensitive bare forms). */
function sharedPrefixLen(a: string[], b: string[]) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && bare(a[i]) === bare(b[i])) i += 1;
  return i;
}

function sameStem(a: string, b: string) {
  const x = bare(a);
  const y = bare(b);
  const n = Math.min(4, x.length, y.length);
  return n >= 3 && x.slice(0, n) === y.slice(0, n);
}

function fold(word: string) {
  return bare(word).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Same spoken word after the ASR settled spelling, accent or ending. */
function alike(a: string, b: string) {
  const x = fold(a);
  const y = fold(b);
  if (x === y) return true;
  const n = Math.min(4, x.length, y.length);
  return n >= 3 && x.slice(0, n) === y.slice(0, n);
}

/** Longest suffix of `prev` that matches a prefix of `next`. */
function overlapSuffixPrefix(prev: string[], next: string[]) {
  const max = Math.min(prev.length, next.length, 40);
  for (let k = max; k >= 1; k -= 1) {
    let ok = true;
    for (let i = 0; i < k; i += 1) {
      if (bare(prev[prev.length - k + i]) !== bare(next[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  return 0;
}

export class SourceTape {
  /** Permanently confirmed words (whole session, bounded). */
  private confirmed: string[] = [];
  /** Open phrase: confirmed portion of the current utterance. */
  private openConfirmed: string[] = [];
  /** Unstable tip (last 1–2 words) — may rewrite on interim. */
  private tip: string[] = [];
  private lastInputAt = 0;
  private lastOpenKey = "";
  /** Tip words a pause froze before the ASR committed them. */
  private frozenTip: string[] = [];

  reset() {
    this.confirmed = [];
    this.openConfirmed = [];
    this.tip = [];
    this.lastInputAt = 0;
    this.lastOpenKey = "";
    this.frozenTip = [];
  }

  msSinceLastInput(now = Date.now()) {
    if (!this.lastInputAt) return Number.POSITIVE_INFINITY;
    return now - this.lastInputAt;
  }

  hasOpen() {
    return this.openConfirmed.length > 0 || this.tip.length > 0;
  }

  getConfirmedText() {
    return this.confirmed.join(" ");
  }

  getOpenText() {
    return joinWords([this.openConfirmed.join(" "), this.tip.join(" ")]);
  }

  getOpenStable() {
    return this.openConfirmed.join(" ").trim();
  }

  getContextWindow(maxWords = 80) {
    if (this.confirmed.length <= maxWords) return this.confirmed.join(" ");
    return this.confirmed.slice(-maxWords).join(" ");
  }

  push(raw: string, isFinal: boolean, now = Date.now()): TapePushResult {
    this.lastInputAt = now;
    const text = normalize(raw);
    const frozen: string[] = [];

    if (!text) {
      return this.snapshot(frozen, false, false);
    }

    const incoming = wordsOf(text);
    this.absorb(incoming, isFinal);

    // Freeze completed sentences inside the open phrase
    while (true) {
      const open = this.getOpenText();
      const cut = this.cutFirstSentence(open);
      if (!cut) break;
      frozen.push(cut.sentence);
      this.appendConfirmed(cut.sentence);
      const rest = wordsOf(cut.rest);
      const tipKeep = Math.min(TIP_WORDS, rest.length);
      this.openConfirmed = rest.slice(0, Math.max(0, rest.length - tipKeep));
      this.tip = rest.slice(Math.max(0, rest.length - tipKeep));
    }

    if (wordsOf(this.getOpenText()).length >= MAX_OPEN_WORDS) {
      const block = this.getOpenText().trim();
      if (block) {
        frozen.push(block);
        this.appendConfirmed(block);
        this.openConfirmed = [];
        this.tip = [];
      }
    }

    const open = this.getOpenText();
    const openKey = open.toLowerCase();
    const openChanged = openKey !== this.lastOpenKey;
    this.lastOpenKey = openKey;

    return this.snapshot(frozen, openChanged, frozen.length > 0 && !this.hasOpen());
  }

  /**
   * ASR that already separates committed words from the unstable tip (WhisperLiveKit).
   * `committed` holds only new words, so nothing is matched or guessed: append, never repeat.
   */
  pushCommitted(committed: string, tip: string, now = Date.now()): TapePushResult {
    this.lastInputAt = now;
    let fresh = wordsOf(committed);
    const nextTip = wordsOf(tip);
    const frozen: string[] = [];

    // A pause froze the tip before the ASR committed it: skip those words once.
    if (this.frozenTip.length && fresh.length) {
      const n = Math.min(this.frozenTip.length, fresh.length);
      let k = 0;
      // "graca" frozen, "graça" committed: same word, only the spelling settled.
      while (k < n && alike(this.frozenTip[k], fresh[k])) {
        k += 1;
      }
      // The whole delta was the frozen tip: the rest of the tip may still arrive.
      this.frozenTip = k === fresh.length ? this.frozenTip.slice(k) : [];
      fresh = fresh.slice(k);
    }

    this.openConfirmed.push(...fresh);
    this.tip = nextTip;

    // Close every finished sentence inside committed words; the tip may still change.
    while (true) {
      const cut = this.cutCommittedSentence();
      if (!cut) break;
      frozen.push(cut);
      this.appendConfirmed(cut);
    }

    const clause = this.cutLongClause();
    if (clause) {
      frozen.push(clause);
      this.appendConfirmed(clause);
    }

    if (this.openWords().length >= MAX_OPEN_WORDS && this.openConfirmed.length) {
      const block = this.openConfirmed.join(" ");
      frozen.push(block);
      this.appendConfirmed(block);
      this.openConfirmed = [];
    }

    const open = this.getOpenText();
    const openKey = open.toLowerCase();
    const openChanged = openKey !== this.lastOpenKey;
    this.lastOpenKey = openKey;
    return this.snapshot(frozen, openChanged, frozen.length > 0 && !this.hasOpen());
  }

  /** Readable blocks: a long sentence closes at a clause break, never mid-clause. */
  private cutLongClause(): string | null {
    const words = this.openConfirmed;
    if (words.length < CLAUSE_SPLIT_WORDS) return null;
    for (let i = words.length - 2; i >= MIN_CLAUSE_WORDS - 1; i -= 1) {
      if (!CLAUSE_END.test(words[i])) continue;
      this.openConfirmed = words.slice(i + 1);
      return words.slice(0, i + 1).join(" ");
    }
    return null;
  }

  private cutCommittedSentence(): string | null {
    const words = this.openConfirmed;
    for (let i = 0; i < words.length; i += 1) {
      if (!END_SENTENCE.test(words[i])) continue;
      if (i + 1 < 3) continue; // "Amém." joins the next sentence
      const sentence = words.slice(0, i + 1).join(" ");
      this.openConfirmed = words.slice(i + 1);
      return sentence;
    }
    return null;
  }

  /** Close the open phrase after silence (call from timer). */
  freezeSilence(now = Date.now()): TapePushResult {
    if (!this.hasOpen()) {
      return this.snapshot([], false, false);
    }
    if (now - this.lastInputAt < silenceNeeded(this.getOpenText())) {
      return this.snapshot([], false, false);
    }

    const open = this.getOpenText();
    const frozen: string[] = [];
    if (open.trim()) {
      frozen.push(open.trim());
      this.appendConfirmed(open);
    }
    this.frozenTip = [...this.tip];
    this.openConfirmed = [];
    this.tip = [];
    this.lastOpenKey = "";
    return this.snapshot(frozen, false, true);
  }

  /** Force-close open phrase (stop listening). */
  flushAll(): TapePushResult {
    const open = this.getOpenText();
    const frozen: string[] = [];
    if (open.trim()) {
      frozen.push(open.trim());
      this.appendConfirmed(open);
    }
    this.frozenTip = [...this.tip];
    this.openConfirmed = [];
    this.tip = [];
    this.lastOpenKey = "";
    return this.snapshot(frozen, false, true);
  }

  private absorb(incoming: string[], isFinal: boolean) {
    // Chrome resends the whole current utterance, including words already frozen.
    // Keep only the part after that confirmed tail — never paste the sentence again.
    const confirmedOverlap = overlapSuffixPrefix(this.confirmed, incoming);
    if (confirmedOverlap >= 3) {
      const fresh = incoming.slice(confirmedOverlap);
      if (fresh.length) this.splitOpen(fresh, isFinal);
      return;
    }

    const openNow = this.openWords();
    const revised = sharedPrefixLen(openNow, incoming);
    const dropped = openNow.length - revised;
    const extendsOpen = revised > 0 && revised === openNow.length;
    const revisesTail = revised >= 2 && dropped <= 4;
    // "testa" → "testando": the unstable tip was rewritten, not a second sentence.
    const replacesTip =
      this.openConfirmed.length === 0 &&
      openNow.length > 0 &&
      openNow.length <= 3 &&
      revised === 0 &&
      sameStem(openNow[0] ?? "", incoming[0] ?? "");
    if (openNow.length && (extendsOpen || revisesTail || replacesTip)) {
      this.splitOpen(incoming, isFinal);
      return;
    }

    const absorbed = [...this.confirmed, ...openNow];
    const overlap = overlapSuffixPrefix(absorbed, incoming);
    const fresh = incoming.slice(overlap);
    if (!fresh.length) return;

    // New fragment that does not repeat the open line (Chrome restarted mid-sentence).
    this.splitOpen([...openNow, ...fresh], isFinal);
  }

  private openWords() {
    return [...this.openConfirmed, ...this.tip];
  }

  private splitOpen(words: string[], isFinal: boolean) {
    if (!words.length) {
      this.openConfirmed = [];
      this.tip = [];
      return;
    }
    if (isFinal || END_SENTENCE.test(words.at(-1) ?? "")) {
      this.openConfirmed = words;
      this.tip = [];
      return;
    }
    const tipKeep = Math.min(TIP_WORDS, words.length);
    this.openConfirmed = words.slice(0, words.length - tipKeep);
    this.tip = words.slice(words.length - tipKeep);
  }

  private cutFirstSentence(text: string): { sentence: string; rest: string } | null {
    const match = text.match(/^([\s\S]+?[.?!…])(?:\s+|$)/);
    if (!match) return null;
    const sentence = match[1].trim();
    if (wordsOf(sentence).length < 3) return null;
    const rest = text.slice(match[0].length).trim();
    // Need either more text after, or treat as freeze only via silence —
    // if the whole open is one sentence and still growing, wait for silence
    // unless isFinal already moved tip into openConfirmed.
    if (!rest && this.tip.length) return null;
    return { sentence, rest };
  }

  private appendConfirmed(text: string) {
    const words = wordsOf(text);
    if (!words.length) return;
    // Never drop already-confirmed words — only append
    const overlap = overlapSuffixPrefix(this.confirmed, words);
    this.confirmed.push(...words.slice(overlap));
    if (this.confirmed.length > 2000) {
      this.confirmed = this.confirmed.slice(-1200);
    }
  }

  private snapshot(
    frozen: string[],
    openChanged: boolean,
    frozeOpen: boolean,
  ): TapePushResult {
    return {
      confirmed: this.getConfirmedText(),
      open: this.getOpenText(),
      openStable: this.getOpenStable(),
      tip: this.tip.join(" "),
      frozen,
      openChanged,
      frozeOpen,
    };
  }
}

const tapes = new Map<string, SourceTape>();

export function getSourceTape(code: string): SourceTape {
  let tape = tapes.get(code);
  if (!tape) {
    tape = new SourceTape();
    tapes.set(code, tape);
  }
  return tape;
}

export function clearSourceTape(code: string) {
  tapes.delete(code);
}
