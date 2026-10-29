import type { Caption, LanguageCode } from "./types.js";

export type PipelineJob = {
  seq: number;
  text: string;
  /** Prior source speech for contextual translation (not displayed again). */
  context: string;
  sourceLang: LanguageCode;
  targets: LanguageCode[];
};

type PipelineHooks = {
  translate: (job: PipelineJob) => Promise<Caption>;
  write: (caption: Caption) => void;
};

/** Few workers — NVIDIA polish is sequential; avoid huge backlog */
const TRANSLATE_WORKERS = 2;

/**
 * Free text-only pipeline per space (no LLM, no TTS):
 *   1. listen  — semantic clauses from the phrase buffer
 *   2. translate — up to 3 jobs in parallel (listener languages only)
 *   3. write — emit captions in seq order; never overwrite prior finals
 */
export class SpacePipeline {
  private nextSeq = 1;
  private nextWriteSeq = 1;
  private listenQueue: PipelineJob[] = [];
  private translateInFlight = 0;
  private writeBuffer = new Map<number, Caption>();
  private closed = false;
  private hooks: PipelineHooks;

  constructor(hooks: PipelineHooks) {
    this.hooks = hooks;
  }

  /** Stage 1 — listen */
  hear(
    text: string,
    sourceLang: LanguageCode,
    targets: LanguageCode[],
    context = "",
  ) {
    if (this.closed) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    this.listenQueue.push({
      seq: this.nextSeq,
      text: trimmed,
      context: context.trim(),
      sourceLang,
      targets,
    });
    this.nextSeq += 1;
    this.pumpTranslate();
  }

  clear() {
    this.closed = true;
    this.listenQueue = [];
    this.writeBuffer.clear();
  }

  private pumpTranslate() {
    while (
      !this.closed &&
      this.translateInFlight < TRANSLATE_WORKERS &&
      this.listenQueue.length > 0
    ) {
      const job = this.listenQueue.shift();
      if (!job) break;
      this.translateInFlight += 1;
      void this.runTranslate(job);
    }
  }

  private async runTranslate(job: PipelineJob) {
    try {
      const caption = await this.hooks.translate(job);
      if (this.closed) return;
      this.writeBuffer.set(job.seq, caption);
      this.pumpWrite();
    } catch {
      // Never stall ordered writes — emit source text as last resort
      if (!this.closed) {
        const translations = Object.fromEntries(
          [job.sourceLang, ...job.targets].map((lang) => [lang, job.text]),
        ) as Caption["translations"];
        this.writeBuffer.set(job.seq, {
          id: `fallback-${job.seq}`,
          original: job.text,
          translated: job.text,
          translations,
          isFinal: true,
          at: Date.now(),
        });
        this.pumpWrite();
      }
    } finally {
      this.translateInFlight -= 1;
      this.pumpTranslate();
    }
  }

  /** Stage 3 — write in order so lines never jump or overwrite */
  private pumpWrite() {
    while (this.writeBuffer.has(this.nextWriteSeq)) {
      const caption = this.writeBuffer.get(this.nextWriteSeq);
      this.writeBuffer.delete(this.nextWriteSeq);
      this.nextWriteSeq += 1;
      if (caption) this.hooks.write(caption);
    }
  }
}

const pipelines = new Map<string, SpacePipeline>();

export function ensurePipeline(code: string, hooks: PipelineHooks): SpacePipeline {
  const existing = pipelines.get(code);
  if (existing) return existing;
  const created = new SpacePipeline(hooks);
  pipelines.set(code, created);
  return created;
}

export function clearPipeline(code: string) {
  pipelines.get(code)?.clear();
  pipelines.delete(code);
}
