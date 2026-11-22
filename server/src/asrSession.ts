/**
 * One WhisperLiveKit websocket per booth. PCM in, transcript text out.
 */
import { writeLog } from "./boot.js";
import { getAsrStatus, whisperWsUrl } from "./whisperSidecar.js";
import { WlkStream, type WlkFrame } from "./wlkTranscript.js";

type AsrLink = {
  ws: WebSocket;
  stream: WlkStream;
  onText: AsrTextHandler;
};

/** `committed` holds only words never sent before; `tip` replaces the previous tip. */
export type AsrTextHandler = (committed: string, tip: string) => void;

const links = new Map<string, AsrLink>();

function socketCtor(): typeof WebSocket | null {
  return typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
}

export function openAsrSession(
  code: string,
  language: string,
  onText: AsrTextHandler,
) {
  closeAsrSession(code);
  const status = getAsrStatus();
  const WS = socketCtor();
  if (!status.ready || status.mode !== "whisperlivekit" || !WS) return false;

  const ws = new WS(whisperWsUrl(language));
  const link: AsrLink = { ws, stream: new WlkStream(), onText };
  links.set(code, link);

  ws.addEventListener("message", (event) => {
    const current = links.get(code);
    if (!current || current.ws !== ws) return;
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw) return;
    let frame: WlkFrame;
    try {
      frame = JSON.parse(raw) as WlkFrame;
    } catch {
      return;
    }
    const delta = current.stream.next(frame);
    if (delta) current.onText(delta.committed, delta.tip);
  });

  ws.addEventListener("error", () => {
    writeLog(`[asr] websocket error for ${code}`);
  });
  ws.addEventListener("close", () => {
    const current = links.get(code);
    if (current?.ws === ws) links.delete(code);
  });

  return true;
}

export function writeAsrPcm(code: string, pcm: Buffer | ArrayBuffer) {
  const link = links.get(code);
  if (!link || link.ws.readyState !== WebSocket.OPEN) return false;
  const bytes =
    pcm instanceof ArrayBuffer
      ? new Uint8Array(pcm)
      : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  link.ws.send(bytes);
  return true;
}

export function closeAsrSession(code: string) {
  const link = links.get(code);
  if (!link) return;
  links.delete(code);
  try {
    link.ws.close();
  } catch {
    /* already closed */
  }
}
