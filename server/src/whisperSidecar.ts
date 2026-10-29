/**
 * Optional local WhisperLiveKit process.
 * ASR only: no --target-language. Falls back to Web Speech when `wlk` is missing.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { writeLog } from "./boot.js";
import { resolveTool } from "./paths.js";

export type AsrMode = "whisperlivekit" | "webspeech";

type SidecarState = {
  mode: AsrMode;
  ready: boolean;
  port: number;
  model: string;
  error: string | null;
};

const state: SidecarState = {
  mode: "webspeech",
  ready: false,
  port: 8000,
  model: "small",
  error: null,
};

let child: ChildProcess | null = null;
let starting: Promise<SidecarState> | null = null;

export function asrBackendRequested() {
  return (process.env.ASR_BACKEND ?? "").trim().toLowerCase() === "whisperlivekit";
}

export function getAsrStatus(): SidecarState {
  return { ...state };
}

export function whisperWsUrl(language: string) {
  const lang = language.trim() || process.env.WLK_LANGUAGE?.trim() || "pt";
  return `ws://127.0.0.1:${state.port}/asr?language=${encodeURIComponent(lang)}`;
}

function commandExists(bin: string) {
  const checker = process.platform === "win32" ? "where" : "which";
  return new Promise<boolean>((resolve) => {
    const probe = spawn(checker, [bin], { stdio: "ignore" });
    probe.on("error", () => resolve(false));
    probe.on("exit", (code) => resolve(code === 0));
  });
}

async function waitForHealth(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return true;
    } catch {
      /* model still loading */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export function startWhisperSidecar(): Promise<SidecarState> {
  if (starting) return starting;
  starting = boot();
  return starting;
}

async function boot(): Promise<SidecarState> {
  if (!asrBackendRequested()) {
    state.mode = "webspeech";
    state.ready = false;
    writeLog("ASR backend: Web Speech (set ASR_BACKEND=whisperlivekit to use WhisperLiveKit)");
    return getAsrStatus();
  }

  const requested = process.env.WLK_BIN?.trim() || "wlk";
  const bin = resolveTool(requested);
  const port = Number(process.env.WLK_PORT ?? 8000);
  const model = process.env.WLK_MODEL?.trim() || "small";
  const language = process.env.WLK_LANGUAGE?.trim() || "pt";
  state.port = Number.isFinite(port) ? port : 8000;
  state.model = model;

  const found = existsSync(bin) || (await commandExists(requested));
  if (!found) {
    state.mode = "webspeech";
    state.ready = false;
    state.error = `${requested} not found — booth will use Web Speech`;
    writeLog(state.error);
    return getAsrStatus();
  }

  const launch = /python(\d+)?(\.exe)?$/i.test(path.basename(bin))
    ? ["-c", "from whisperlivekit.cli import main; main()"]
    : [];

  const args = [
    "--model",
    model,
    "--language",
    language,
    "--backend-policy",
    "simulstreaming",
    "--host",
    "127.0.0.1",
    "--port",
    String(state.port),
    "--pcm-input",
    "--pause-segmentation-seconds",
    process.env.WLK_PAUSE_SECONDS?.trim() || "1.2",
  ];

  writeLog(`starting WhisperLiveKit: ${bin} ${[...launch, ...args].join(" ")}`);
  child = spawn(bin, [...launch, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) writeLog(`[wlk] ${line}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) writeLog(`[wlk] ${line}`);
  });
  child.on("exit", (code) => {
    state.ready = false;
    state.mode = "webspeech";
    state.error = `WhisperLiveKit exited (${code ?? "signal"}) — booth falls back to Web Speech`;
    writeLog(state.error);
    child = null;
  });

  const healthy = await waitForHealth(state.port, 180_000);
  if (!healthy || !child) {
    state.mode = "webspeech";
    state.ready = false;
    state.error = "WhisperLiveKit did not become healthy — booth will use Web Speech";
    writeLog(state.error);
    return getAsrStatus();
  }

  state.mode = "whisperlivekit";
  state.ready = true;
  state.error = null;
  writeLog(`WhisperLiveKit ready on 127.0.0.1:${state.port} (${model}, ${language})`);
  return getAsrStatus();
}

export function stopWhisperSidecar() {
  if (!child) return;
  child.kill("SIGTERM");
  child = null;
  state.ready = false;
}
