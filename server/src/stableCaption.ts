/**
 * Display stabilizer for re-translated live captions.
 *
 * Each new machine translation of the open sentence may reorder or swap words.
 * Showing every hypothesis makes text the listener already read jump around.
 * Policy (LocalAgreement-2 + monotonic display):
 *  - show only the word prefix two consecutive hypotheses agree on;
 *  - never retract shown words, except a small fix at the very tail;
 *  - the final caption (sentence closed) replaces the line once.
 */

function wordsOf(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function key(word: string) {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?…"“”'«»()¿¡،؟]+/g, "");
}

function commonPrefix(a: string[], b: string[]) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && key(a[i]) === key(b[i])) i += 1;
  return i;
}

/** Shown words that may still be swapped when the translation settles. */
const TAIL_FIX_WORDS = 2;

export type StableStats = {
  /** Words ever shown. */
  shown: number;
  /** Shown words later replaced (erasure). */
  erased: number;
};

export class StableText {
  private shown: string[] = [];
  private last: string[] = [];
  private readonly stats: StableStats = { shown: 0, erased: 0 };

  reset() {
    this.shown = [];
    this.last = [];
  }

  getStats(): StableStats {
    return { ...this.stats };
  }

  current() {
    return this.shown.join(" ");
  }

  /** Feed one full translation of the open line; returns the text to display. */
  update(hypothesis: string): string {
    const next = wordsOf(hypothesis);
    if (!next.length) return this.current();
    const agreed = commonPrefix(this.last, next);
    this.last = next;
    return this.commit(next.slice(0, agreed));
  }

  /**
   * The source stopped growing (speaker paused, nothing newer queued): this is
   * the translation of everything heard, so it can be shown whole.
   */
  settle(hypothesis: string): string {
    const next = wordsOf(hypothesis);
    if (!next.length) return this.current();
    this.last = next;
    return this.commit(next);
  }

  private commit(candidate: string[]): string {
    if (candidate.length <= this.shown.length) {
      // Not longer than what is on screen: never shrink, never rewrite.
      return this.current();
    }

    const keep = commonPrefix(this.shown, candidate);
    const rewrite = this.shown.length - keep;
    if (rewrite === 0) {
      this.stats.shown += candidate.length - this.shown.length;
      this.shown = candidate;
    } else if (rewrite <= TAIL_FIX_WORDS && keep > 0) {
      // "the" → "this": small fix at the tail, the line grows past it.
      this.stats.erased += rewrite;
      this.stats.shown += candidate.length - keep;
      this.shown = candidate;
    }
    // A larger disagreement waits for the final caption.
    return this.current();
  }
}
