export const FLOOR_DB = -90;
export const LOW_RMS_DB = -40;
export const CLIP_PEAK_DB = -1;
export const LOW_HOLD_MS = 3000;
export const CLIP_HOLD_MS = 2000;
/** Recommended peak range for the mixer feed. */
export const TARGET_PEAK_MIN_DB = -18;
export const TARGET_PEAK_MAX_DB = -6;

export type LevelStatus = "ok" | "low" | "clip";

/** Linear amplitude (0..1) to dBFS, floored at FLOOR_DB. */
export function dbfs(amplitude: number): number {
  if (!(amplitude > 0)) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(amplitude));
}

/** Peak and RMS (linear) of a block. */
export function measureBlock(samples: ArrayLike<number>): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  const n = samples.length;
  for (let i = 0; i < n; i += 1) {
    const v = samples[i] ?? 0;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: n ? Math.sqrt(sum / n) : 0 };
}

/** Maps dBFS to a 0..1 bar position (-60..0 dBFS). */
export function meterFraction(db: number): number {
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/**
 * Stateful classifier. "low" when no block had RMS above LOW_RMS_DB for
 * LOW_HOLD_MS; "clip" while within CLIP_HOLD_MS of a peak >= CLIP_PEAK_DB.
 * Clip takes precedence over low.
 */
export function createLevelClassifier() {
  let started = false;
  let lastVoiceAt = 0;
  let clipUntil = -Infinity;

  return {
    push(peakDb: number, rmsDb: number, nowMs: number): LevelStatus {
      if (!started) {
        started = true;
        lastVoiceAt = nowMs;
      }
      if (rmsDb >= LOW_RMS_DB) lastVoiceAt = nowMs;
      if (peakDb >= CLIP_PEAK_DB) clipUntil = nowMs + CLIP_HOLD_MS;
      if (nowMs < clipUntil) return "clip";
      if (nowMs - lastVoiceAt >= LOW_HOLD_MS) return "low";
      return "ok";
    },
    reset() {
      started = false;
      lastVoiceAt = 0;
      clipUntil = -Infinity;
    },
  };
}
