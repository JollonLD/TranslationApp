/**
 * WER harness for the ASR (WhisperLiveKit over websocket).
 * Run: npm run wer -w server -- --audio talk.wav --ref ref.txt [--url ws://...] [--realtime] [--out report.json]
 * Offline: npm run wer -w server -- --ref ref.txt --hyp hyp.txt
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WlkStream, type WlkFrame } from "../wlkTranscript.js";

export const SAMPLE_RATE = 16000;
const BYTES_PER_100MS = (SAMPLE_RATE * 2) / 10;

// ---------- pure logic ----------

export function normalizeForWer(text: string, _lang = "pt", foldAccents = false): string {
  let t = text.toLowerCase().normalize("NFC");
  if (foldAccents) t = t.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
  t = t.replace(/[^\p{L}\p{N}\s]+/gu, " ");
  return t.replace(/\s+/g, " ").trim();
}

export type WerResult = {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refWords: number;
  missedWords: string[];
  insertedWords: string[];
};

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/) : []);

/** Word-level Levenshtein alignment of already-normalised strings. */
export function wer(ref: string, hyp: string): WerResult {
  const r = words(ref);
  const h = words(hyp);
  const n = r.length;
  const m = h.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sub = d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1);
      d[i][j] = Math.min(sub, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  const missedWords: string[] = [];
  const insertedWords: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1)) {
      if (r[i - 1] !== h[j - 1]) substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      deletions += 1;
      missedWords.push(r[i - 1]);
      i -= 1;
    } else {
      insertions += 1;
      insertedWords.push(h[j - 1]);
      j -= 1;
    }
  }
  missedWords.reverse();
  insertedWords.reverse();
  return {
    wer: n === 0 ? (m === 0 ? 0 : 1) : (substitutions + deletions + insertions) / n,
    substitutions,
    deletions,
    insertions,
    refWords: n,
    missedWords,
    insertedWords,
  };
}

export function topWords(list: string[], limit = 15): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const w of list) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

// ---------- audio ----------

export const WAV_CONVERT_HINT = "Convert with: ffmpeg -i in -ar 16000 -ac 1 -c:a pcm_s16le out.wav";

/** Validate a WAV header (16 kHz, mono, PCM16) and return the raw PCM data. */
export function parseWav(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a RIFF/WAVE file. ${WAV_CONVERT_HINT}`);
  }
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      if (body + 16 > buf.length) throw new Error("Truncated WAV fmt chunk.");
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data chunk before fmt chunk.");
      if (fmt.format !== 1 && fmt.format !== 0xfffe) {
        throw new Error(`WAV is not PCM (format ${fmt.format}). ${WAV_CONVERT_HINT}`);
      }
      if (fmt.rate !== SAMPLE_RATE || fmt.channels !== 1 || fmt.bits !== 16) {
        throw new Error(
          `WAV must be 16 kHz mono 16-bit, got ${fmt.rate} Hz, ${fmt.channels} ch, ${fmt.bits}-bit. ${WAV_CONVERT_HINT}`,
        );
      }
      const end = Math.min(body + size, buf.length);
      const len = (end - body) & ~1;
      return buf.subarray(body, body + len);
    }
    pos = body + size + (size & 1);
  }
  throw new Error(fmt ? "WAV has no data chunk." : "WAV has no fmt chunk.");
}

export async function loadPcm(path: string): Promise<Buffer> {
  const buf = await readFile(path);
  if (/\.wav$/i.test(path)) return parseWav(buf);
  return buf.subarray(0, buf.length & ~1);
}

// ---------- ASR over websocket ----------

export type TranscribeOptions = {
  url: string;
  realtime?: boolean;
  /** Pause between blocks when not realtime. */
  paceMs?: number;
  connectTimeoutMs?: number;
  /** Max wait with no frames after the audio was sent. */
  idleTimeoutMs?: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function transcribePcm(pcm: Buffer, opts: TranscribeOptions): Promise<string> {
  const WS = globalThis.WebSocket;
  if (typeof WS !== "function") throw new Error("Global WebSocket missing: Node 22+ is required.");
  const connectTimeout = opts.connectTimeoutMs ?? 10_000;
  const idleTimeout = opts.idleTimeoutMs ?? 30_000;

  const ws = new WS(opts.url);
  const stream = new WlkStream();
  const committed: string[] = [];
  let tip = "";
  let closed = false;
  let lastFrameAt = Date.now();
  let readyToStop = false;

  ws.addEventListener("message", (event) => {
    lastFrameAt = Date.now();
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw) return;
    let frame: (WlkFrame & { type?: string }) | null = null;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame) return;
    if (frame.type === "ready_to_stop") {
      readyToStop = true;
      return;
    }
    const delta = stream.next(frame);
    if (delta) {
      if (delta.committed) committed.push(delta.committed);
      tip = delta.tip;
    }
  });
  ws.addEventListener("close", () => {
    closed = true;
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out connecting to ${opts.url} after ${connectTimeout} ms.`)),
      connectTimeout,
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not connect to ${opts.url}. Is WhisperLiveKit running? (start the app server or the sidecar first)`,
        ),
      );
    });
  });

  const started = Date.now();
  for (let off = 0; off < pcm.length; off += BYTES_PER_100MS) {
    if (closed) throw new Error("Server closed the connection while audio was being sent.");
    const end = Math.min(off + BYTES_PER_100MS, pcm.length);
    ws.send(pcm.subarray(off, end));
    if (opts.realtime) {
      const wait = started + ((end / 2) / SAMPLE_RATE) * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
    } else {
      await sleep(opts.paceMs ?? 5);
    }
  }
  // Empty message tells WhisperLiveKit the audio ended.
  if (!closed) ws.send(new Uint8Array(0));
  lastFrameAt = Date.now();

  while (!closed && !readyToStop) {
    if (Date.now() - lastFrameAt > idleTimeout) break;
    await sleep(100);
  }
  try {
    ws.close();
  } catch {
    /* already closed */
  }
  return [...committed, tip].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// ---------- CLI ----------

type Args = {
  audio?: string;
  ref?: string;
  hyp?: string;
  url: string;
  realtime: boolean;
  out?: string;
  fold: boolean;
  lang: string;
};

export function parseArgs(argv: string[]): Args {
  const a: Args = { url: "ws://127.0.0.1:8000/asr?language=pt", realtime: false, fold: false, lang: "pt" };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${k}`);
      return v;
    };
    if (k === "--audio") a.audio = val();
    else if (k === "--ref") a.ref = val();
    else if (k === "--hyp") a.hyp = val();
    else if (k === "--url") a.url = val();
    else if (k === "--out") a.out = val();
    else if (k === "--lang") a.lang = val();
    else if (k === "--realtime") a.realtime = true;
    else if (k === "--fold-accents") a.fold = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!a.ref) throw new Error("--ref <ref.txt> is required.");
  if (!a.audio && !a.hyp) throw new Error("Provide --audio <file.wav|.pcm> or --hyp <hyp.txt>.");
  if (a.audio && a.hyp) throw new Error("Use either --audio or --hyp, not both.");
  return a;
}

export async function runWer(argv: string[], log: (line: string) => void = console.log) {
  const args = parseArgs(argv);
  const refText = await readFile(args.ref!, "utf8");
  let hypText: string;
  if (args.hyp) {
    hypText = await readFile(args.hyp, "utf8");
  } else {
    const pcm = await loadPcm(args.audio!);
    if (!pcm.length) throw new Error("Audio has no samples.");
    const secs = pcm.length / 2 / SAMPLE_RATE;
    log(`Audio: ${secs.toFixed(1)} s${args.realtime ? " (realtime)" : ""} -> ${args.url}`);
    hypText = await transcribePcm(pcm, { url: args.url, realtime: args.realtime });
  }
  const ref = normalizeForWer(refText, args.lang, args.fold);
  const hyp = normalizeForWer(hypText, args.lang, args.fold);
  const r = wer(ref, hyp);
  const top = topWords(r.missedWords);
  const pct = (r.wer * 100).toFixed(2);
  log(`WER: ${pct}%  (ref words ${r.refWords}, hyp words ${words(hyp).length})`);
  log(`S=${r.substitutions}  D=${r.deletions}  I=${r.insertions}`);
  log(`Missed words (deletions): ${r.deletions} (${r.refWords ? ((r.deletions / r.refWords) * 100).toFixed(2) : "0.00"}% of ref)`);
  if (top.length) log(`Top missed: ${top.map((t) => `${t.word}x${t.count}`).join(", ")}`);
  if (args.out) {
    await writeFile(
      args.out,
      JSON.stringify({ ...r, werPercent: Number(pct), topMissed: top, hypothesis: hyp, source: args.audio ?? args.hyp }, null, 2),
    );
    log(`Report written to ${args.out}`);
  }
  return r;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runWer(process.argv.slice(2)).catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
