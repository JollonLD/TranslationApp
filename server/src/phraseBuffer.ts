/**
 * Streaming phrase buffer with a permanent commit cursor + rolling context.
 * Prefers full sentences / breath pauses so captions stay readable.
 *
 * Flow: listen → accumulate → release on sentence or pause → translate with context.
 */
export const PAUSE_MS = 780;
const STABLE_MS = 260;
const TAIL_WORDS = 2;
/** Soft release only for real sentence endings. */
const MIN_SENTENCE_WORDS = 5;
/** On silence, release a readable phrase (not tiny scraps). */
const MIN_PAUSE_WORDS = 4;
/** Hard safety net — prefer waiting for pause/sentence before this. */
const MAX_PENDING_WORDS = 24;
/** How much prior source speech to attach for translation context. */
const CONTEXT_WORDS = 100;
const END_PUNCT = /[.?!…]$/;
const CLAUSE_BREAK = /[,;:]$/;

const FILLER = new Set([
  "uh",
  "um",
  "ah",
  "eh",
  "hm",
  "hmm",
  "hum",
  "er",
  "tipo",
  "né",
  "ne",
  "well",
  "like",
]);
// Keep “então / assim / aí” — they carry sermon meaning

export type PhraseCommit = {
  text: string;
  /** Prior committed speech (not re-emitted) — for contextual translation. */
  context: string;
  isFinal: boolean;
};

export type PhraseSnapshot = {
  commits: PhraseCommit[];
  tail: string;
};

type WordState = {
  text: string;
  since: number;
};

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function cleanDisfluency(text: string) {
  const words = normalize(text).split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const bare = word.toLowerCase().replace(/[.,;:!?…]+$/g, "");
    if (!bare || FILLER.has(bare)) continue;
    const prev = kept.at(-1);
    if (prev && prev.toLowerCase() === word.toLowerCase() && word.length <= 4) continue;
    kept.push(word);
  }
  return kept.join(" ").trim();
}

function wordsOf(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

function wordCount(text: string) {
  return wordsOf(text).length;
}

function normKey(text: string) {
  return normalize(text)
    .toLowerCase()
    .replace(/[.,;:!?…]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function joinWords(parts: string[]) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Case-insensitive prefix strip (committed cursor advance). */
export function stripCommittedPrefix(full: string, committed: string): string {
  const fullWords = wordsOf(full);
  const committedWords = wordsOf(committed);
  if (!committedWords.length) return normalize(full);
  if (!fullWords.length) return "";

  let i = 0;
  while (
    i < committedWords.length &&
    i < fullWords.length &&
    fullWords[i].toLowerCase().replace(/[.,;:!?…]+$/g, "") ===
      committedWords[i].toLowerCase().replace(/[.,;:!?…]+$/g, "")
  ) {
    i += 1;
  }

  // Incoming is a full restart that still begins like committed — drop matched prefix
  if (i > 0) return fullWords.slice(i).join(" ").trim();

  // Incoming is a new Chrome segment: drop only overlapping head/tail words
  return stripOverlappingPrefix(full, committed);
}

/** Drop leading words of `next` that repeat the tail of `previous`. */
export function stripOverlappingPrefix(next: string, previous: string): string {
  const a = wordsOf(previous);
  const b = wordsOf(next);
  if (!a.length || !b.length) return normalize(next);

  const max = Math.min(a.length, b.length);
  let overlap = 0;
  for (let k = max; k >= 1; k -= 1) {
    let ok = true;
    for (let i = 0; i < k; i += 1) {
      const left = a[a.length - k + i].toLowerCase().replace(/[.,;:!?…]+$/g, "");
      const right = b[i].toLowerCase().replace(/[.,;:!?…]+$/g, "");
      if (left !== right) {
        ok = false;
        break;
      }
    }
    if (ok) {
      overlap = k;
      break;
    }
  }
  return b.slice(overlap).join(" ").trim();
}

function overlapWordCount(a: string, b: string): number {
  const aw = wordsOf(a).map((w) => w.toLowerCase());
  const bw = wordsOf(b).map((w) => w.toLowerCase());
  let best = 0;
  const max = Math.min(aw.length, bw.length, 8);
  for (let k = max; k >= 1; k -= 1) {
    if (aw.slice(0, k).join(" ") === bw.slice(0, k).join(" ")) {
      best = k;
      break;
    }
  }
  return best;
}

export class PhraseBuffer {
  /** All text already released this listening session — never re-emitted. */
  private committed = "";
  /** Stable words waiting for a release. */
  private pending: WordState[] = [];
  /** Unstable tip (last 1–2 ASR words). */
  private live: WordState[] = [];
  private lastInputAt = 0;

  reset() {
    this.committed = "";
    this.pending = [];
    this.live = [];
    this.lastInputAt = 0;
  }

  hasPending(): boolean {
    return this.pending.length > 0 || this.live.length > 0;
  }

  msSinceLastInput(now = Date.now()): number {
    if (!this.lastInputAt) return Number.POSITIVE_INFINITY;
    return now - this.lastInputAt;
  }

  /** Full committed text (for outer-layer dedupe). */
  getCommittedText(): string {
    return this.committed;
  }

  /** Last N words already released — used as MT context without re-emitting. */
  getContextWindow(maxWords = CONTEXT_WORDS): string {
    const parts = wordsOf(this.committed);
    if (parts.length <= maxWords) return this.committed;
    return parts.slice(-maxWords).join(" ");
  }

  push(raw: string, isFinal: boolean, now = Date.now()): PhraseSnapshot {
    const text = cleanDisfluency(raw);
    this.lastInputAt = now;

    if (!text) {
      return { commits: [], tail: this.displayTail() };
    }

    // Only keep what is still ahead of the commit cursor
    const uncommitted = this.projectIncoming(text);
    if (!uncommitted) {
      // ASR repeated something already released — promote tip then ignore
      if (isFinal) this.promoteLiveToPending();
      return { commits: [], tail: this.displayTail() };
    }

    const commits: PhraseCommit[] = [];

    // New Chrome segment (not a growth of current pending) → release pending first
    if (this.hasPending() && !this.isContinuation(uncommitted)) {
      commits.push(...this.forceReleasePending());
    }

    if (isFinal) {
      this.absorbFinal(uncommitted, now);
    } else {
      this.syncHypothesis(uncommitted, now);
    }

    const more = this.release(now, "soft");
    return {
      commits: [...commits, ...more.commits],
      tail: this.displayTail(),
    };
  }

  /** True when incoming continues/revises the current uncommitted hypothesis. */
  private isContinuation(uncommitted: string): boolean {
    const current = joinWords([this.pendingText(), this.liveText()]);
    if (!current) return true;
    const u = normKey(uncommitted);
    const c = normKey(current);
    if (u.startsWith(c) || c.startsWith(u)) return true;
    if (overlapWordCount(uncommitted, current) >= 2) return true;
    return false;
  }

  /** Release every uncommitted word (used on utterance change). */
  private forceReleasePending(): PhraseCommit[] {
    this.promoteLiveToPending();
    const text = this.pendingText();
    this.pending = [];
    const piece = this.advanceCursor(text);
    return piece
      ? [{ text: piece.text, context: piece.context, isFinal: true }]
      : [];
  }

  drainPause(now = Date.now()): PhraseSnapshot {
    if (!this.hasPending()) return { commits: [], tail: "" };
    if (now - this.lastInputAt < PAUSE_MS) {
      return { commits: [], tail: this.displayTail() };
    }
    this.promoteLiveToPending();
    return this.release(now, "pause");
  }

  flushAll(now = Date.now()): PhraseSnapshot {
    this.promoteLiveToPending();
    const text = this.pendingText();
    this.pending = [];
    this.live = [];
    this.lastInputAt = now;
    const piece = this.advanceCursor(text);
    return {
      commits: piece
        ? [{ text: piece.text, context: piece.context, isFinal: true }]
        : [],
      tail: "",
    };
  }

  /**
   * Map ASR text onto the stream ahead of `committed`.
   * Handles cumulative interims, new final segments, and mild revisions.
   */
  private projectIncoming(text: string): string {
    const key = normKey(text);
    const committedKey = normKey(this.committed);

    if (!key) return "";
    if (committedKey && (committedKey === key || committedKey.includes(key))) return "";

    // Cumulative hypothesis that still starts with what we already released
    if (committedKey && key.startsWith(committedKey)) {
      return stripCommittedPrefix(text, this.committed);
    }

    const absorbed = joinWords([this.committed, this.pendingText(), this.liveText()]);
    const absorbedKey = normKey(absorbed);
    if (absorbedKey && key.startsWith(absorbedKey)) {
      return stripCommittedPrefix(text, this.committed);
    }

    // Revision of current utterance (shared prefix with absorbed stream)
    if (absorbed && overlapWordCount(text, absorbed) >= 2) {
      return stripCommittedPrefix(text, this.committed);
    }

    // Fresh Chrome segment — only strip head overlapping the committed tail
    return stripOverlappingPrefix(text, this.committed);
  }

  private absorbFinal(uncommitted: string, now: number) {
    const already = joinWords([this.pendingText(), this.liveText()]);
    const uKey = normKey(uncommitted);
    const aKey = normKey(already);

    // Final confirms or revises the current hypothesis — keep the fuller text
    if (
      !already ||
      uKey === aKey ||
      uKey.startsWith(aKey) ||
      aKey.startsWith(uKey) ||
      overlapWordCount(uncommitted, already) >= 2
    ) {
      const fuller =
        wordCount(uncommitted) >= wordCount(already) ? uncommitted : already;
      this.pending = wordsOf(fuller).map((w) => ({ text: w, since: now }));
      this.live = [];
      return;
    }

    // Brand-new final segment after unrelated pending: keep pending, append new words
    this.promoteLiveToPending();
    for (const w of wordsOf(uncommitted)) {
      this.pending.push({ text: w, since: now });
    }
    this.live = [];
  }

  private syncHypothesis(uncommitted: string, now: number) {
    const incoming = wordsOf(uncommitted);
    if (!incoming.length) {
      this.pending = [];
      this.live = [];
      return;
    }

    const previous = [...this.pending, ...this.live];
    const next: WordState[] = incoming.map((text, i) => {
      const prev = previous[i];
      return {
        text,
        since: prev && prev.text === text ? prev.since : now,
      };
    });

    const tailKeep = END_PUNCT.test(incoming.at(-1) ?? "") ? 1 : TAIL_WORDS;
    const pending: WordState[] = [];
    const live: WordState[] = [];

    for (let i = 0; i < next.length; i += 1) {
      const atTip = i >= next.length - tailKeep;
      if (!atTip && now - next[i].since >= STABLE_MS) pending.push(next[i]);
      else live.push(next[i]);
    }

    this.pending = pending;
    this.live = live;
  }

  private promoteLiveToPending() {
    if (!this.live.length) return;
    this.pending.push(...this.live);
    this.live = [];
  }

  private release(now: number, reason: "soft" | "pause"): PhraseSnapshot {
    void now;
    const commits: PhraseCommit[] = [];

    while (true) {
      const piece = this.takeChunk(reason);
      if (!piece) break;
      const advanced = this.advanceCursor(piece);
      if (advanced) {
        commits.push({
          text: advanced.text,
          context: advanced.context,
          isFinal: true,
        });
      }
    }

    return { commits, tail: this.displayTail() };
  }

  private takeChunk(reason: "soft" | "pause"): string | null {
    const held = this.pendingText();
    if (!held) return null;

    const n = wordCount(held);
    const endsSentence = END_PUNCT.test(held);
    const endsClause = CLAUSE_BREAK.test(held);

    if (reason === "pause") {
      // Breath pause → one readable line (whole pending hold)
      if (n >= MIN_PAUSE_WORDS || endsSentence) {
        this.pending = [];
        return held;
      }
      return null;
    }

    // Soft while speaking: only complete sentences — never chop on commas mid-thought
    if (endsSentence && n >= MIN_SENTENCE_WORDS) {
      const cut = this.cutAtSentence(held);
      if (cut) return cut;
      this.pending = [];
      return held;
    }
    const sentenceCut = this.cutAtSentence(held);
    if (sentenceCut) return sentenceCut;

    // Safety: very long run without punctuation — cut at last clause, else hard cap
    if (n >= MAX_PENDING_WORDS) {
      const clause = this.cutAtClause(held, 10);
      if (clause) return clause;
      const parts = wordsOf(held);
      const head = parts.slice(0, MAX_PENDING_WORDS).join(" ");
      this.pending = parts.slice(MAX_PENDING_WORDS).map((text) => ({
        text,
        since: this.lastInputAt,
      }));
      return head;
    }

    void endsClause;
    return null;
  }

  private cutAtSentence(text: string): string | null {
    const match = text.match(/^([\s\S]+?[.?!…])(?:\s+|$)/);
    if (!match) return null;
    const piece = match[1].trim();
    if (wordCount(piece) < MIN_SENTENCE_WORDS) return null;
    const rest = text.slice(match[0].length).trim();
    this.pending = wordsOf(rest).map((w) => ({ text: w, since: this.lastInputAt }));
    return piece;
  }

  private cutAtClause(text: string, minWords: number): string | null {
    const match = text.match(/^([\s\S]+?[,;:])(?:\s+|$)/);
    if (!match) return null;
    const piece = match[1].trim();
    if (wordCount(piece) < minWords) return null;
    const rest = text.slice(match[0].length).trim();
    this.pending = wordsOf(rest).map((w) => ({ text: w, since: this.lastInputAt }));
    return piece;
  }

  /**
   * Permanently advance cursor — committed text can never be released again.
   * Returns the new segment plus the context window from BEFORE this segment.
   */
  private advanceCursor(text: string): { text: string; context: string } | null {
    let out = normalize(text);
    if (!out) return null;

    out = stripCommittedPrefix(out, this.committed);
    if (!out) return null;

    const key = normKey(out);
    const committedKey = normKey(this.committed);
    if (committedKey && (committedKey === key || committedKey.endsWith(key))) return null;

    const context = this.getContextWindow(CONTEXT_WORDS);
    this.committed = joinWords([this.committed, out]);
    // Keep committed from growing without bound (session sermon can be long)
    const committedWords = wordsOf(this.committed);
    if (committedWords.length > 400) {
      this.committed = committedWords.slice(-200).join(" ");
    }
    return { text: out, context };
  }

  private pendingText() {
    return this.pending.map((w) => w.text).join(" ").trim();
  }

  private liveText() {
    return this.live.map((w) => w.text).join(" ").trim();
  }

  private displayTail() {
    // Tail is ONLY uncommitted speech — never includes released captions
    return joinWords([this.pendingText(), this.liveText()]);
  }
}

const buffers = new Map<string, PhraseBuffer>();

export function getPhraseBuffer(code: string): PhraseBuffer {
  let buffer = buffers.get(code);
  if (!buffer) {
    buffer = new PhraseBuffer();
    buffers.set(code, buffer);
  }
  return buffer;
}

export function clearPhraseBuffer(code: string) {
  buffers.delete(code);
}
