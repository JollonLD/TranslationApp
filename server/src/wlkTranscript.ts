/** Map a WhisperLiveKit `/asr` JSON frame onto one tape update. */

export type WlkFrame = {
  lines?: Array<{ text?: string | null }>;
  buffer_transcription?: string | null;
};

export type WlkUtterance = {
  /** Committed lines joined. */
  stable: string;
  /** Unstable tip still being rewritten. */
  tip: string;
  /** What the tape should see. */
  full: string;
  /** A line just closed and the tip is empty. */
  isFinal: boolean;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function wordsOf(text: string) {
  return clean(text).split(" ").filter(Boolean);
}

function bare(word: string) {
  return word.toLowerCase().replace(/[.,;:!?…"“”'«»()]+/g, "");
}

function sharedPrefixLen(a: string[], b: string[]) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && bare(a[i]) === bare(b[i])) i += 1;
  return i;
}

/** Longest suffix of `prev` equal to a prefix of `next`. */
function overlapSuffixPrefix(prev: string[], next: string[], max = 60) {
  const limit = Math.min(prev.length, next.length, max);
  for (let k = limit; k >= 1; k -= 1) {
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

export type WlkDelta = {
  /** Committed words never handed to the tape before. */
  committed: string;
  /** Unstable tip, replaces the previous tip. */
  tip: string;
};

/**
 * WhisperLiveKit resends every committed line of the session in each frame.
 * Hand the tape only what is new, by word position, so a sentence is never pasted twice.
 */
export class WlkStream {
  private delivered: string[] = [];
  private lastTip = "";

  reset() {
    this.delivered = [];
    this.lastTip = "";
  }

  next(frame: WlkFrame): WlkDelta | null {
    const stable = wordsOf(
      (frame.lines ?? []).map((line) => clean(line.text)).filter(Boolean).join(" "),
    );
    const tip = clean(frame.buffer_transcription);
    const prev = this.delivered;

    let fresh: string[];
    const shared = sharedPrefixLen(prev, stable);
    if (shared === prev.length) {
      fresh = stable.slice(shared);
    } else if (stable.length >= prev.length && prev.length - shared <= 6) {
      // Punctuation or a late word fix inside text already sent: keep position.
      fresh = stable.slice(prev.length);
    } else {
      // Server restarted or trimmed its history: continue from the overlap.
      fresh = stable.slice(overlapSuffixPrefix(prev, stable));
    }

    if (stable.length) this.delivered = stable;
    if (!fresh.length && tip === this.lastTip) return null;
    this.lastTip = tip;
    return { committed: fresh.join(" "), tip };
  }
}

export function utteranceFromWlk(frame: WlkFrame, previousStable = ""): WlkUtterance {
  const stable = (frame.lines ?? [])
    .map((line) => clean(line.text))
    .filter(Boolean)
    .join(" ");
  const tip = clean(frame.buffer_transcription);
  const full = [stable, tip].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const grew = stable.length > previousStable.length && stable.startsWith(previousStable.trim());
  return {
    stable,
    tip,
    full,
    isFinal: Boolean(stable) && !tip && grew,
  };
}
