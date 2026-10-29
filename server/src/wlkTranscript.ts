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
