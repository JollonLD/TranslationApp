/**
 * Optional local NLLB worker. Used for Persian/Urdu and when Riva has no draft.
 * Missing Python or a failed model load leaves translation on Google.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { writeLog } from "./boot.js";
import { polishChurchTerms } from "./churchGlossary.js";
import { resolveTool, resourceDir } from "./paths.js";
import type { LanguageCode } from "./types.js";

type Pending = {
  resolve: (text: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

let child: ChildProcessWithoutNullStreams | null = null;
let ready = false;
let seq = 0;
const pending = new Map<string, Pending>();

function nllbRequested() {
  const flag = (process.env.NLLB_ENABLED ?? "auto").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

function workerScript() {
  const beside = path.join(resourceDir(), "asr", "nllb_worker.py");
  if (existsSync(beside)) return beside;
  return path.join(resourceDir(), "server", "asr", "nllb_worker.py");
}

function settle(id: string, text: string | null) {
  const job = pending.get(id);
  if (!job) return;
  clearTimeout(job.timer);
  pending.delete(id);
  job.resolve(text);
}

export function nllbReady() {
  return ready;
}

export function startNllbWorker() {
  if (!nllbRequested() || child) return;
  const python = resolveTool(process.env.NLLB_PYTHON?.trim() || "python3");
  const script = workerScript();
  if (!existsSync(script)) {
    writeLog(`[nllb] worker script missing (${script})`);
    return;
  }
  try {
    child = spawn(python, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
  } catch (error) {
    writeLog(`[nllb] could not start (${error instanceof Error ? error.message : error})`);
    child = null;
    return;
  }

  child.on("error", (error) => {
    ready = false;
    writeLog(`[nllb] process error (${error.message}) — Google remains the fallback`);
    for (const id of [...pending.keys()]) settle(id, null);
    child = null;
  });
  child.on("exit", (code) => {
    ready = false;
    writeLog(`[nllb] exited (${code ?? "signal"})`);
    for (const id of [...pending.keys()]) settle(id, null);
    child = null;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) writeLog(`[nllb] ${line}`);
  });

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let payload: { ready?: boolean; error?: string; id?: string | null; text?: string };
    try {
      payload = JSON.parse(line) as typeof payload;
    } catch {
      return;
    }
    if (typeof payload.ready === "boolean" && payload.id == null) {
      ready = payload.ready;
      writeLog(payload.ready ? "[nllb] ready" : `[nllb] unavailable (${payload.error ?? "unknown"})`);
      return;
    }
    if (payload.id == null) return;
    const text = (payload.text ?? "").trim();
    settle(String(payload.id), text || null);
  });
}

export function stopNllbWorker() {
  ready = false;
  child?.kill("SIGTERM");
  child = null;
}

export function translateNllb(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve("");
  if (source === target) return Promise.resolve(trimmed);
  if (!ready || !child) return Promise.resolve(null);

  const id = String(++seq);
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => settle(id, null), 20_000);
    pending.set(id, { resolve, timer });
    child?.stdin.write(
      `${JSON.stringify({ id, text: trimmed.slice(0, 1200), source, target })}\n`,
    );
  }).then((out) => (out ? polishChurchTerms(out, target) : null));
}
