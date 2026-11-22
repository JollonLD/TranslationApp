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

function wordMatch(a: string, b: string) {
  return fold(a) === fold(b);
}

/** `cut` is the cut-off start of `full` ("tro" / "trovava", "filipp" / "filippesi"). */
function cutOff(cut: string, full: string) {
  const x = fold(cut);
  const y = fold(full);
  return x.length >= 2 && y.length > x.length && y.startsWith(x);
}

/**
 * Words two hypotheses share from the start. Only the older one's LAST word may
 * be cut off ("si tro" → "si trovava"), so "dio" never swallows "di".
 */
function fuzzyPrefix(older: string[], newer: string[]) {
  const n = Math.min(older.length, newer.length);
  let i = 0;
  while (i < n) {
    if (wordMatch(older[i], newer[i])) i += 1;
    else if (i === older.length - 1 && cutOff(older[i], newer[i])) i += 1;
    else break;
  }
  return i;
}

/**
 * The recognizer added, dropped or swapped a word or two at the start
 * ("sono andato" → "io sono andato", "il pane" → "al pane").
 */
function shiftedStart(older: string[], newer: string[]) {
  for (let off = 1; off <= 2; off += 1) {
    const need = (n: number) => Math.min(3, n);
    if (older.length - off >= 2 && newer.length > off && fuzzyPrefix(older.slice(off), newer.slice(off)) >= need(older.length - off)) return true;
    if (newer.length > off && fuzzyPrefix(older, newer.slice(off)) >= need(older.length) && older.length >= 2) return true;
    if (older.length > off && fuzzyPrefix(older.slice(off), newer) >= need(older.length - off) && older.length - off >= 2) return true;
  }
  return false;
}

/** Longest prefix of `incoming` found as a contiguous run inside `known`. */
function longestKnownPrefix(known: string[], incoming: string[]) {
  let best = 0;
  let bestAtEnd = false;
  for (let s = 0; s < known.length; s += 1) {
    if (!wordMatch(known[s], incoming[0] ?? "")) continue;
    let k = 0;
    while (s + k < known.length && k < incoming.length && wordMatch(known[s + k], incoming[k])) k += 1;
    if (k > best || (k === best && s + k === known.length)) {
      best = k;
      bestAtEnd = s + k === known.length;
    }
  }
  return { length: best, atEnd: bestAtEnd };
}

/**
 * Edge dictation turns "… come"/"… com…" into a fake web address and glues the
 * words before it ("nonso.com", "chiosservaisuoi.com"). The same words are
 * always said again right after, so a long glued token is dropped and a short
 * one keeps its word.
 */
export function cleanWebSpeech(text: string) {
  return text
    .split(/\s+/)
    .map((token) => {
      const m = token.match(/^(\S+?)\.(?:com|ca)([.,!?…]*)$/i);
      if (!m) return token;
      return m[1].length >= 14 ? "" : `${m[1]}${m[2]}`;
    })
    .filter(Boolean)
    .join(" ");
}

/** A pause longer than this ends a burst of re-segmenting finals. */
const RESEGMENT_GAP_MS = 1_500;

/** Recent words checked when a new utterance may only resend what was said. */
const RESEND_WINDOW = 60;


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
  /*
   * Web Speech (Chrome/Edge) sends the whole current utterance on every update.
   * The tape tracks that utterance so a revision replaces it instead of being
   * appended, and words already frozen are never pasted again.
   */
  /** Open words left over from earlier utterances. */
  private carry: string[] = [];
  /** Latest hypothesis of the current utterance. */
  private utt: string[] = [];
  /** How many words of `utt` were already frozen. */
  private uttFrozen = 0;
  /** A final closed the utterance: the next update starts a new one. */
  private uttClosed = true;
  /** Length of the last real utterance: late finals may resend any part of it. */
  private prevUttLength = 0;
  /**
   * Finals arriving right after an open interim re-segment what was just shown
   * (Edge sends punctuated sentences for it). Inside that burst even a one-word
   * overlap with the end is a resend.
   */
  private resegmenting = false;

  reset() {
    this.confirmed = [];
    this.openConfirmed = [];
    this.tip = [];
    this.lastInputAt = 0;
    this.lastOpenKey = "";
    this.frozenTip = [];
    this.carry = [];
    this.utt = [];
    this.uttFrozen = 0;
    this.uttClosed = true;
    this.prevUttLength = 0;
    this.resegmenting = false;
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
    const gap = this.lastInputAt ? now - this.lastInputAt : Number.POSITIVE_INFINITY;
    this.lastInputAt = now;
    const text = normalize(cleanWebSpeech(raw));
    const frozen: string[] = [];

    if (!text) {
      return this.snapshot(frozen, false, false);
    }

    this.absorbUtterance(wordsOf(text), isFinal, gap);

    // Freeze completed sentences inside the open phrase
    while (true) {
      const cut = this.cutFirstSentence(this.getOpenText());
      if (!cut) break;
      frozen.push(cut.sentence);
      this.appendConfirmed(cut.sentence);
      this.consumeOpen(wordsOf(cut.sentence).length);
    }

    if (wordsOf(this.getOpenText()).length >= MAX_OPEN_WORDS) {
      const block = this.getOpenText().trim();
      if (block) {
        frozen.push(block);
        this.appendConfirmed(block);
        this.consumeOpen(wordsOf(block).length);
      }
    }

    const open = this.getOpenText();
    const openKey = open.toLowerCase();
    const openChanged = openKey !== this.lastOpenKey;
    this.lastOpenKey = openKey;

    return this.snapshot(frozen, openChanged, frozen.length > 0 && !this.hasOpen());
  }

  private absorbUtterance(incoming: string[], isFinal: boolean, gap: number) {
    // Text that reached the tape another way (ASR fallback) stays open, and the
    // browser may resend its end: treat it like an open utterance.
    let adopted = false;
    if (!this.utt.length && !this.carry.length && this.openWords().length) {
      this.carry = this.openWords();
      adopted = true;
    }

    const prevOpen = (!this.uttClosed && this.utt.length > 0) || adopted;
    const sameUtterance =
      !adopted &&
      prevOpen &&
      (fuzzyPrefix(this.utt, incoming) >= Math.min(2, this.utt.length, incoming.length) ||
        shiftedStart(this.utt, incoming));
    // Revision of the utterance on screen: replace it, keep frozen words frozen.
    // If the frozen words cannot be found in it, it is not the same utterance.
    const cut = sameUtterance ? this.alignFrozen(incoming) : -1;

    if (cut >= 0) {
      this.utt = incoming;
      this.uttFrozen = cut;
    } else {
      // A new utterance. It may only resend words already said (a late final,
      // a restart of the recognizer): keep just what is new.
      if (this.utt.length) this.prevUttLength = this.utt.length;
      if (!isFinal || gap > RESEGMENT_GAP_MS) this.resegmenting = false;
      if (isFinal && prevOpen) this.resegmenting = true;
      const fresh = this.dropResent(incoming, prevOpen, gap);
      this.carry = this.openWords();
      this.utt = fresh;
      this.uttFrozen = 0;
    }
    this.uttClosed = isFinal;
    this.layoutOpen();
  }

  /** Where the frozen part of the utterance ends inside a revised hypothesis; -1 if absent. */
  private alignFrozen(incoming: string[]) {
    if (!this.uttFrozen) return 0;
    if (fuzzyPrefix(this.utt, incoming) >= this.uttFrozen) return this.uttFrozen;
    if (this.uttFrozen >= this.utt.length && incoming.length <= this.uttFrozen && fuzzyPrefix(incoming, this.utt) === incoming.length) {
      return incoming.length; // a shorter resend of words already frozen
    }
    const anchor = this.utt.slice(Math.max(0, this.uttFrozen - 3), this.uttFrozen);
    let bestEnd = -1;
    let bestDistance = Infinity;
    for (let i = 0; i + anchor.length <= incoming.length; i += 1) {
      let ok = true;
      for (let k = 0; k < anchor.length; k += 1) {
        if (!wordMatch(anchor[k], incoming[i + k])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const end = i + anchor.length;
      const distance = Math.abs(end - this.uttFrozen);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEnd = end;
      }
    }
    return bestEnd;
  }

  /**
   * Strip what a new utterance only resends. A resend is likely while the
   * previous utterance was still open or right after it (a burst of finals);
   * after a real pause the speaker repeating himself is speech, kept whole.
   */
  private dropResent(incoming: string[], prevOpen: boolean, gap: number) {
    const resendLikely = prevOpen || this.resegmenting || gap <= RESEGMENT_GAP_MS;
    if (!resendLikely) return incoming;
    const window = RESEND_WINDOW + Math.max(this.utt.length, this.prevUttLength);
    const known = [...this.confirmed.slice(-window), ...this.openWords()];
    const { length, atEnd } = longestKnownPrefix(known, incoming);
    const whole = length === incoming.length;
    // 4+ words already said in a row, a whole 3-word resend, or a restart that
    // overlaps the very last words: that part was heard already.
    const burst = prevOpen || this.resegmenting;
    // Inside a burst: a 4+ word run, a whole 3-word resend, or an overlap with the
    // very end. Right after a closed sentence: only a long run ending at the end.
    const strip = burst
      ? length >= 4 || (whole && length >= 3) || (atEnd && (whole || length >= 2 || (this.resegmenting && length >= 1)))
      : atEnd && length >= 4;
    if (strip) {
      return incoming.slice(length);
    }
    return incoming;
  }

  /** Open line = carry + the not-yet-frozen part of the utterance. */
  private layoutOpen() {
    const live = this.utt.slice(this.uttFrozen);
    const words = [...this.carry, ...live];
    if (this.uttClosed || END_SENTENCE.test(words.at(-1) ?? "")) {
      this.openConfirmed = words;
      this.tip = [];
      return;
    }
    const tipKeep = Math.min(TIP_WORDS, live.length);
    this.openConfirmed = words.slice(0, words.length - tipKeep);
    this.tip = words.slice(words.length - tipKeep);
  }

  /** `count` words left the open line (frozen): carry first, then the utterance. */
  private consumeOpen(count: number) {
    const fromCarry = Math.min(count, this.carry.length);
    this.carry = this.carry.slice(fromCarry);
    this.uttFrozen = Math.min(this.utt.length, this.uttFrozen + count - fromCarry);
    this.layoutOpen();
  }

  /**
   * ASR that already separates committed words from the unstable tip (WhisperLiveKit).
   * `committed` holds only new words, so nothing is matched or guessed: append, never repeat.
   */
  pushCommitted(committed: string, tip: string, now = Date.now()): TapePushResult {
    this.lastInputAt = now;
    // Another ASR now owns the open line: forget the Web Speech utterance.
    this.carry = [];
    this.utt = [];
    this.uttFrozen = 0;
    this.uttClosed = true;
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
    // The utterance may keep growing after the pause: only new words follow.
    this.carry = [];
    this.uttFrozen = this.utt.length;
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
    // The utterance may keep growing after the pause: only new words follow.
    this.carry = [];
    this.uttFrozen = this.utt.length;
    this.lastOpenKey = "";
    return this.snapshot(frozen, false, true);
  }

  private openWords() {
    return [...this.openConfirmed, ...this.tip];
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
    // Frozen text is exact (no resend reaches here): append as is, so a word
    // the speaker really repeated ("di no. no no") is kept.
    this.confirmed.push(...words);
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
