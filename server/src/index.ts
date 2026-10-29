import { createServer } from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { installCrashGuard, loadEnvFile, writeLog } from "./boot.js";
import { openAppWindow } from "./desktop.js";
import { firewallHint } from "./firewall.js";
import { getLanAddresses, localHostname, primaryLanAddress } from "./network.js";
import { useResourceCwd, webDistDir } from "./paths.js";

installCrashGuard();
const appRoot = useResourceCwd();
const envFile = loadEnvFile();
writeLog(`starting Chiesa Il Faro from ${appRoot}`);
if (envFile) writeLog(`loaded env from ${envFile}`);
if (process.env.NVIDIA_API_KEY?.trim()) {
  writeLog(
    `NVIDIA fast MT: ${process.env.NVIDIA_MT_MODEL?.trim() || "nvidia/riva-translate-4b-instruct-v2"}; LLM: ${process.env.NVIDIA_LLM_MODEL?.trim() || process.env.NVIDIA_MODEL?.trim() || "stepfun-ai/step-5-preview"}`,
  );
}
import {
  clearLiveEngine,
  ensureLiveEngine,
  fillMissingLanguages,
} from "./liveEngine.js";
import {
  claimHost,
  createSpace,
  endSpace,
  getSpace,
  normalizeCode,
  publicSpace,
  pushCaption,
  releaseHost,
  setHostTail,
  setLanguages,
  setListening,
  setTranslateHealth,
  updateCaption,
} from "./spaces.js";
import { closeAsrSession, openAsrSession, writeAsrPcm } from "./asrSession.js";
import { startNllbWorker } from "./nllbTranslate.js";
import { buildFullTranscript, buildSermonNotes } from "./sermonNotes.js";
import { getRivaHealth } from "./rivaTranslate.js";
import { clearTranslateSession, getTranslateHealth } from "./translate.js";
import { getAsrStatus, startWhisperSidecar } from "./whisperSidecar.js";
import { startPublicTunnel } from "./tunnel.js";
import { isLanguage, type Caption, type LanguageCode, type Space } from "./types.js";

let publicBaseUrl = "";

function isUsablePublicBase(base: string) {
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return false;
    if (host === "api.trycloudflare.com" || host === "www.trycloudflare.com") return false;
    return true;
  } catch {
    return false;
  }
}

function viewerLink(code: string) {
  if (publicBaseUrl && isUsablePublicBase(publicBaseUrl)) {
    return `${publicBaseUrl.replace(/\/$/, "")}/ouvir/${code}`;
  }
  return `http://${primaryLanAddress()}:${listenPort}/ouvir/${code}`;
}

const PORT = Number(process.env.PORT ?? 3000);
let listenPort = PORT;
const roomName = (code: string) => `space:${normalizeCode(code)}`;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/asr", (_req, res) => {
  res.json(getAsrStatus());
});

app.get("/api/network", (_req, res) => {
  const addresses = getLanAddresses();
  res.json({
    port: PORT,
    addresses,
    primary: addresses[0] ?? "127.0.0.1",
    hostname: localHostname(),
    firewallHint: firewallHint(),
    publicBaseUrl: publicBaseUrl || null,
  });
});

app.get("/api/spaces/:code", (req, res) => {
  const space = getSpace(req.params.code);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  res.json({
    code: space.code,
    sourceLang: space.sourceLang,
    targetLang: space.targetLang,
    listening: space.listening,
  });
});

const webDist = webDistDir();
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
    next();
    return;
  }
  res.sendFile(path.join(webDist, "index.html"), (error) => {
    if (error) next();
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

function listenerCount(code: string) {
  return io.sockets.adapter.rooms.get(roomName(code))?.size ?? 0;
}

function emitSpace(code: string) {
  const space = getSpace(code);
  if (!space) return;
  io.to(roomName(code)).emit("space:state", publicSpace(space, Math.max(0, listenerCount(code) - (space.hostId ? 1 : 0))));
}

function listenerTargets(code: string): LanguageCode[] {
  const langs = new Set<LanguageCode>();
  for (const client of io.sockets.sockets.values()) {
    if (client.data.code === code && client.data.role === "listener" && isLanguage(client.data.targetLang)) {
      langs.add(client.data.targetLang);
    }
  }
  return [...langs];
}

async function fillTranslations(space: Space, langs: LanguageCode[], limit = 80) {
  const changed = await fillMissingLanguages(space.captions, space.sourceLang, langs, limit);
  syncTranslateHealth(space);
  return changed;
}

function syncTranslateHealth(space: Space) {
  const fallback = getTranslateHealth();
  const riva = getRivaHealth();
  const health =
    riva === "down" && fallback === "down"
      ? "down"
      : riva === "degraded" || fallback === "degraded"
        ? "degraded"
        : "ok";
  if (space.translateHealth !== health) {
    setTranslateHealth(space, health);
    return true;
  }
  return false;
}

function mergeLivePartial(space: Space, caption: Caption) {
  const prev = space.lastPartial;
  if (prev && prev.id === caption.id) {
    const translations = { ...prev.translations, ...caption.translations };
    for (const [lang, value] of Object.entries(caption.translations)) {
      if (!value) delete translations[lang as LanguageCode];
    }
    space.lastPartial = {
      ...prev,
      ...caption,
      translations,
      translated: caption.translated || prev.translated,
      original: caption.original || prev.original,
    };
  } else {
    setHostTail(space, caption.original);
    space.lastPartial = caption;
  }
  return space.lastPartial!;
}

function engineFor(code: string) {
  return ensureLiveEngine(code, {
    getSourceLang: () => getSpace(code)?.sourceLang ?? "pt",
    getTargets: () => {
      const space = getSpace(code);
      const requested = listenerTargets(code);
      if (requested.length) return requested;
      return space ? [space.targetLang] : ["en"];
    },
    onLive: (caption) => {
      const live = getSpace(code);
      if (!live) return;
      const merged = mergeLivePartial(live, caption);
      io.to(roomName(live.code)).emit("caption:live", merged);
      io.to(roomName(live.code)).emit("space:tail", {
        code: live.code,
        tail: merged.original,
        partial: merged,
      });
      if (syncTranslateHealth(live)) emitSpace(live.code);
    },
    onUpdate: (caption) => {
      const live = getSpace(code);
      if (!live) return;
      const updated = updateCaption(live, caption);
      io.to(roomName(live.code)).emit("caption:update", updated);
    },
    onFinal: (caption) => {
      const live = getSpace(code);
      if (!live) return;
      pushCaption(live, caption);
      setHostTail(live, "");
      io.to(roomName(live.code)).emit("caption", caption);
      io.to(roomName(live.code)).emit("space:tail", {
        code: live.code,
        tail: "",
        partial: null,
      });
      if (syncTranslateHealth(live)) emitSpace(live.code);
    },
  });
}

function clearSpaceBuffers(code: string) {
  closeAsrSession(code);
  clearTranslateSession(code);
  clearLiveEngine(code);
}

io.on("connection", (socket) => {
  socket.on(
    "space:create",
    (
      payload: { sourceLang?: LanguageCode; targetLang?: LanguageCode },
      ack?: (result: unknown) => void,
    ) => {
      const space = createSpace(payload?.sourceLang ?? "pt", payload?.targetLang ?? "en");
      claimHost(space, socket.id);
      socket.join(roomName(space.code));
      ack?.({
        ok: true,
        space: publicSpace(space, 0),
        publicUrl: viewerLink(space.code),
        publicBaseUrl: publicBaseUrl || null,
        addresses: getLanAddresses(),
        firewallHint: firewallHint(),
      });
    },
  );

  socket.on(
    "space:join",
    (
      payload: { code: string; role?: "host" | "listener"; targetLang?: LanguageCode },
      ack?: (result: unknown) => void,
    ) => {
      const space = getSpace(payload?.code ?? "");
      if (!space) {
        ack?.({ ok: false, error: "This space does not exist or has already ended." });
        return;
      }

      if (payload.role === "host" && !claimHost(space, socket.id)) {
        ack?.({ ok: false, error: "This space already has a computer capturing audio." });
        return;
      }

      socket.join(roomName(space.code));
      socket.data.code = space.code;
      socket.data.role = payload.role ?? "listener";
      socket.data.targetLang = isLanguage(payload.targetLang) ? payload.targetLang : "en";
      emitSpace(space.code);
      ack?.({
        ok: true,
        space: publicSpace(space, Math.max(0, listenerCount(space.code) - (space.hostId ? 1 : 0))),
        publicUrl: viewerLink(space.code),
        publicBaseUrl: publicBaseUrl || null,
      });

      if (socket.data.role === "listener") {
        void fillTranslations(space, [socket.data.targetLang]).then((changed) => {
          if (changed) emitSpace(space.code);
        });
      }
    },
  );

  socket.on(
    "space:viewLanguage",
    (
      payload: { code: string; lang?: LanguageCode },
      ack?: (result: unknown) => void,
    ) => {
      const space = getSpace(payload?.code ?? "");
      if (!space || !isLanguage(payload.lang)) {
        ack?.({ ok: false, error: "Invalid language." });
        return;
      }
      socket.data.code = space.code;
      socket.data.role = socket.data.role ?? "listener";
      socket.data.targetLang = payload.lang;
      void fillTranslations(space, [payload.lang]).then(() => {
        emitSpace(space.code);
        ack?.({
          ok: true,
          space: publicSpace(space, Math.max(0, listenerCount(space.code) - (space.hostId ? 1 : 0))),
        });
      });
    },
  );

  socket.on(
    "space:notes",
    (
      payload: { code: string; lang?: LanguageCode; summarize?: boolean },
      ack?: (result: unknown) => void,
    ) => {
      const space = getSpace(payload?.code ?? "");
      const lang = isLanguage(payload?.lang)
        ? payload.lang
        : isLanguage(socket.data.targetLang)
          ? socket.data.targetLang
          : "en";
      if (!space) {
        ack?.({ ok: false, error: "This space does not exist or has already ended." });
        return;
      }

      void (async () => {
        try {
          await fillTranslations(space, [lang]);
          if (payload?.summarize) {
            const notes = await buildSermonNotes(space, lang);
            ack?.(notes);
            return;
          }
          const transcript = buildFullTranscript(space, lang);
          ack?.({ ok: true, ...transcript, summary: "" });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Could not build notes.";
          ack?.({ ok: false, error: msg });
        }
      })();
    },
  );

  socket.on(
    "space:languages",
    (payload: { code: string; sourceLang: LanguageCode; targetLang?: LanguageCode }) => {
      const space = getSpace(payload.code);
      if (!space || space.hostId !== socket.id) return;
      setLanguages(space, payload.sourceLang, payload.targetLang ?? space.targetLang);
      emitSpace(space.code);
    },
  );

  socket.on("space:listening", (payload: { code: string; listening: boolean; asr?: string }) => {
    const space = getSpace(payload.code);
    if (!space || space.hostId !== socket.id) return;
    setListening(space, payload.listening);
    if (!payload.listening) {
      closeAsrSession(space.code);
      engineFor(space.code).stop();
      clearLiveEngine(space.code);
      clearTranslateSession(space.code);
      setHostTail(space, "");
    } else {
      clearLiveEngine(space.code);
      clearTranslateSession(space.code);
      engineFor(space.code);
      if (payload.asr === "whisperlivekit") {
        const opened = openAsrSession(space.code, space.sourceLang, (text, isFinal) => {
          const live = getSpace(space.code);
          if (!live || live.hostId !== socket.id) return;
          engineFor(space.code).push(text, isFinal);
        });
        if (!opened) {
          socket.emit("asr:fallback", { reason: "WhisperLiveKit is not ready." });
        }
      }
    }
    emitSpace(space.code);
  });

  socket.on("asr:pcm", (code: string, pcm: Buffer | ArrayBuffer) => {
    const space = getSpace(code ?? "");
    if (!space || space.hostId !== socket.id || !space.listening) return;
    if (!pcm) return;
    writeAsrPcm(space.code, pcm);
  });

  socket.on(
    "transcript",
    (payload: { code: string; text: string; isFinal: boolean }) => {
      const space = getSpace(payload.code);
      if (!space || space.hostId !== socket.id) return;

      const text = payload.text?.trim() ?? "";
      if (!text && !payload.isFinal) return;

      engineFor(space.code).push(text, Boolean(payload.isFinal));
      if (syncTranslateHealth(space)) emitSpace(space.code);
    },
  );

  socket.on("space:end", (payload: { code: string }) => {
    const space = getSpace(payload.code);
    if (!space || space.hostId !== socket.id) return;
    clearSpaceBuffers(space.code);
    io.to(roomName(space.code)).emit("space:ended");
    io.in(roomName(space.code)).socketsLeave(roomName(space.code));
    endSpace(space.code);
  });

  socket.on("disconnect", () => {
    const released = releaseHost(socket.id);
    if (released) {
      closeAsrSession(released.code);
      clearSpaceBuffers(released.code);
      emitSpace(released.code);
    }
    const code = socket.data.code as string | undefined;
    if (code) emitSpace(code);
  });
});

function startListening(port: number, attempt = 0) {
  const onError = (error: NodeJS.ErrnoException) => {
    httpServer.off("error", onError);
    if (error.code === "EADDRINUSE" && attempt < 8) {
      const next = port + 1;
      writeLog(`port ${port} in use, trying ${next}`);
      startListening(next, attempt + 1);
      return;
    }
    writeLog(`listen failed: ${error.message}`);
    throw error;
  };
  httpServer.on("error", onError);

  httpServer.listen(port, "0.0.0.0", () => {
    httpServer.off("error", onError);
    listenPort = port;
    const lan = getLanAddresses();
    const localUrl = `http://localhost:${port}`;
    console.log(`\n  Chiesa Il Faro is running`);
    console.log(`  This computer:  ${localUrl}`);
    for (const address of lan) {
      console.log(`  On the network: http://${address}:${port}`);
    }
    console.log(`  Opening the browser…`);
    console.log(`  Keep this window open during the service.\n`);
    writeLog(`listening on ${localUrl}`);
    openAppWindow(localUrl);

    const tunnel = startPublicTunnel(port);
    void tunnel.ready.then((url) => {
      if (url && isUsablePublicBase(url)) {
        publicBaseUrl = url;
        console.log(`  Public QR:      ${url}\n`);
        io.emit("network:public", { publicBaseUrl: url });
        return;
      }
      if (url) {
        console.warn(`  Ignored invalid tunnel URL: ${url}`);
      }
      console.log(`  Public link unavailable. The QR will use the local address.\n`);
    });
  });
}

void startWhisperSidecar();
startNllbWorker();
startListening(PORT);
