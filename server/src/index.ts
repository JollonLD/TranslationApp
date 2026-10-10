import { createServer } from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { installCrashGuard, writeLog } from "./boot.js";
import { openAppWindow } from "./desktop.js";
import { firewallHint } from "./firewall.js";
import { getLanAddresses, localHostname, primaryLanAddress } from "./network.js";
import { useResourceCwd, webDistDir } from "./paths.js";

installCrashGuard();
const appRoot = useResourceCwd();
writeLog(`starting Chiesa Il Faro from ${appRoot}`);
import {
  clearPhraseBuffer,
  getPhraseBuffer,
  PAUSE_MS,
  stripCommittedPrefix,
  stripOverlappingPrefix,
} from "./phraseBuffer.js";
import { clearPipeline, ensurePipeline, type PipelineJob } from "./pipeline.js";
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
} from "./spaces.js";
import { getTranslateHealth, translateMany } from "./translate.js";
import { startPublicTunnel } from "./tunnel.js";
import { isLanguage, type Caption, type LanguageCode, type Space } from "./types.js";

let publicBaseUrl = "";

function viewerLink(code: string) {
  if (publicBaseUrl) return `${publicBaseUrl.replace(/\/$/, "")}/ouvir/${code}`;
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
  const targets = langs.filter((lang) => lang !== space.sourceLang);
  if (!targets.length) return false;
  const recent = space.captions.slice(-limit);
  let changed = false;
  await Promise.all(
    recent.map(async (caption) => {
      const missing = targets.filter((lang) => !caption.translations[lang]);
      if (!missing.length) return;
      Object.assign(caption.translations, await translateMany(caption.original, space.sourceLang, missing));
      if (!caption.translated) {
        const first = missing.find((lang) => caption.translations[lang]);
        if (first && caption.translations[first]) {
          caption.translated = caption.translations[first]!;
        }
      }
      changed = true;
    }),
  );
  syncTranslateHealth(space);
  return changed;
}

function syncTranslateHealth(space: Space) {
  const health = getTranslateHealth();
  if (space.translateHealth !== health) {
    setTranslateHealth(space, health);
    return true;
  }
  return false;
}

function pipelineFor(code: string) {
  return ensurePipeline(code, {
    // Stage 2 — translate (up to 3 jobs in parallel)
    translate: async (job: PipelineJob) => {
      try {
        const translations = await translateMany(job.text, job.sourceLang, job.targets);
        return makeCaption(job.text, translations, true, job.seq);
      } catch (error) {
        console.warn("[pipeline] translate failed, emitting source text:", error);
        const fallback: Caption["translations"] = { [job.sourceLang]: job.text };
        for (const lang of job.targets) {
          if (lang !== job.sourceLang) fallback[lang] = job.text;
        }
        return makeCaption(job.text, fallback, true, job.seq);
      }
    },
    // Stage 3 — write in order; never rewrites prior captions
    write: (caption) => {
      const live = getSpace(code);
      if (!live) return;
      pushCaption(live, caption);
      const healthChanged = syncTranslateHealth(live);
      io.to(roomName(live.code)).emit("caption", caption);
      if (healthChanged) emitSpace(live.code);
    },
  });
}

const COALESCE_MS = 350;
const COALESCE_MAX_WORDS = 28;
const END_SENTENCE = /[.?!…]$/;

type CoalesceBucket = {
  parts: string[];
  sourceLang: LanguageCode;
  targets: LanguageCode[];
  timer: ReturnType<typeof setTimeout> | null;
};

const coalesceBuckets = new Map<string, CoalesceBucket>();

function wordCount(text: string) {
  return text.split(" ").filter(Boolean).length;
}

/** Join coalesce parts without repeating overlapping ASR fragments. */
function mergeCoalesceParts(parts: string[]): string {
  let out = "";
  for (const part of parts) {
    const next = part.trim().replace(/\s+/g, " ");
    if (!next) continue;
    if (!out) {
      out = next;
      continue;
    }
    const outKey = out.toLowerCase();
    const nextKey = next.toLowerCase();
    if (outKey === nextKey || outKey.includes(nextKey)) continue;
    if (nextKey.includes(outKey)) {
      out = next;
      continue;
    }
    const remainder = stripOverlappingPrefix(next, out);
    if (!remainder) continue;
    out = `${out} ${remainder}`.replace(/\s+/g, " ").trim();
  }
  return out;
}

/** Text already sent to the translate pipeline this session (coalesce-level cursor). */
const releasedToPipeline = new Map<string, string>();

function flushCoalesce(code: string) {
  const bucket = coalesceBuckets.get(code);
  if (!bucket) return;
  if (bucket.timer) clearTimeout(bucket.timer);
  coalesceBuckets.delete(code);
  let text = mergeCoalesceParts(bucket.parts);
  if (!text) return;

  const space = getSpace(code);
  if (!space) return;

  // Pipeline cursor: never re-send what this space already translated
  const already = releasedToPipeline.get(code) ?? "";
  text = stripCommittedPrefix(text, already);
  if (!text) return;
  text = stripOverlappingPrefix(text, already);
  if (!text) return;

  const last = space.captions.at(-1);
  if (last?.isFinal) {
    const prev = last.original.trim().toLowerCase();
    const next = text.toLowerCase();
    if (prev === next || prev.includes(next)) return;
  }

  releasedToPipeline.set(code, [already, text].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  const piped = releasedToPipeline.get(code) ?? "";
  const pipedWords = piped.split(" ").filter(Boolean);
  if (pipedWords.length > 400) {
    releasedToPipeline.set(code, pipedWords.slice(-200).join(" "));
  }

  pipelineFor(code).hear(text, bucket.sourceLang, bucket.targets);
}

/** Merge short commits so listeners get cohesive clauses, not fragments. */
function enqueueCoalesce(space: Space, text: string, targets: LanguageCode[]) {
  const code = space.code;
  let trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return;

  // Drop anything already sent to translate
  const already = releasedToPipeline.get(code) ?? "";
  trimmed = stripCommittedPrefix(trimmed, already);
  trimmed = stripOverlappingPrefix(trimmed, already);
  if (!trimmed) return;

  let bucket = coalesceBuckets.get(code);
  if (!bucket) {
    bucket = {
      parts: [],
      sourceLang: space.sourceLang,
      targets,
      timer: null,
    };
    coalesceBuckets.set(code, bucket);
  } else {
    bucket.sourceLang = space.sourceLang;
    const merged = new Set([...bucket.targets, ...targets]);
    bucket.targets = [...merged];
  }

  const lastPart = bucket.parts.at(-1);
  if (!lastPart || lastPart.toLowerCase() !== trimmed.toLowerCase()) {
    bucket.parts.push(trimmed);
  }

  const joined = mergeCoalesceParts(bucket.parts);
  const shouldFlushNow =
    END_SENTENCE.test(joined) || wordCount(joined) >= COALESCE_MAX_WORDS;

  if (bucket.timer) {
    clearTimeout(bucket.timer);
    bucket.timer = null;
  }

  if (shouldFlushNow) {
    flushCoalesce(code);
    return;
  }

  bucket.timer = setTimeout(() => {
    flushCoalesce(code);
  }, COALESCE_MS);
}

/** Stage 1 — listen: coalesce → parallel translate → ordered write */
function hearPhrase(space: Space, text: string, options?: { allowSingle?: boolean }) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return;
  const words = trimmed.split(" ").filter(Boolean).length;
  if (words < 2 && !options?.allowSingle) return;
  const requested = listenerTargets(space.code);
  const targets = requested.length ? requested : [space.targetLang];
  enqueueCoalesce(space, trimmed, targets);
}

const pauseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function armPauseFlush(code: string, delayMs = PAUSE_MS) {
  const previous = pauseTimers.get(code);
  if (previous) clearTimeout(previous);
  pauseTimers.set(
    code,
    setTimeout(() => {
      pauseTimers.delete(code);
      const space = getSpace(code);
      if (!space || !space.listening) return;
      const buffer = getPhraseBuffer(code);
      const snapshot = buffer.drainPause();
      if (snapshot.tail !== space.hostTail) {
        setHostTail(space, snapshot.tail);
        io.to(roomName(space.code)).emit("space:tail", {
          code: space.code,
          tail: space.hostTail,
          partial: space.lastPartial,
        });
      }
      for (const commit of snapshot.commits) {
        hearPhrase(space, commit.text, { allowSingle: true });
      }
      if (!buffer.hasPending()) return;
      const since = buffer.msSinceLastInput();
      if (since < PAUSE_MS) {
        // Silence window not met yet (e.g. late re-arm) — wait the remainder
        armPauseFlush(code, Math.max(40, PAUSE_MS - since + 20));
        return;
      }
      // Silence ok but remnant too short for pause rules — force out (1-word tails)
      const forced = buffer.flushAll();
      if (forced.tail !== space.hostTail) {
        setHostTail(space, forced.tail);
        io.to(roomName(space.code)).emit("space:tail", {
          code: space.code,
          tail: space.hostTail,
          partial: space.lastPartial,
        });
      }
      for (const commit of forced.commits) {
        hearPhrase(space, commit.text, { allowSingle: true });
      }
    }, delayMs),
  );
}

function clearSpaceBuffers(code: string) {
  const timer = pauseTimers.get(code);
  if (timer) clearTimeout(timer);
  pauseTimers.delete(code);
  const coalesce = coalesceBuckets.get(code);
  if (coalesce?.timer) clearTimeout(coalesce.timer);
  coalesceBuckets.delete(code);
  releasedToPipeline.delete(code);
  clearPhraseBuffer(code);
  clearPipeline(code);
}

function makeCaption(
  text: string,
  translations: Caption["translations"],
  isFinal: boolean,
  seq?: number,
): Caption {
  const preferred =
    Object.values(translations).find((value) => value && value !== text) ||
    translations.en ||
    text;
  return {
    id: `c${seq ?? Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    original: text,
    translations,
    translated: preferred || text,
    isFinal,
    at: Date.now(),
  };
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
    "space:languages",
    (payload: { code: string; sourceLang: LanguageCode; targetLang?: LanguageCode }) => {
      const space = getSpace(payload.code);
      if (!space || space.hostId !== socket.id) return;
      setLanguages(space, payload.sourceLang, payload.targetLang ?? space.targetLang);
      emitSpace(space.code);
    },
  );

  socket.on("space:listening", (payload: { code: string; listening: boolean }) => {
    const space = getSpace(payload.code);
    if (!space || space.hostId !== socket.id) return;
    setListening(space, payload.listening);
    if (!payload.listening) {
      const leftover = getPhraseBuffer(space.code).flushAll();
      for (const commit of leftover.commits) {
        hearPhrase(space, commit.text, { allowSingle: true });
      }
      flushCoalesce(space.code);
      clearPhraseBuffer(space.code);
      releasedToPipeline.delete(space.code);
      const timer = pauseTimers.get(space.code);
      if (timer) clearTimeout(timer);
      pauseTimers.delete(space.code);
      setHostTail(space, "");
    } else {
      // Fresh listen session — new commit cursor
      clearPhraseBuffer(space.code);
      releasedToPipeline.delete(space.code);
    }
    emitSpace(space.code);
  });

  socket.on(
    "transcript",
    (payload: { code: string; text: string; isFinal: boolean }) => {
      const space = getSpace(payload.code);
      if (!space || space.hostId !== socket.id) return;

      const text = payload.text?.trim() ?? "";
      if (!text && !payload.isFinal) return;

      const buffer = getPhraseBuffer(space.code);
      const snapshot = buffer.push(text, Boolean(payload.isFinal));

      if (snapshot.tail !== space.hostTail) {
        setHostTail(space, snapshot.tail);
        io.to(roomName(space.code)).emit("space:tail", {
          code: space.code,
          tail: space.hostTail,
          partial: space.lastPartial,
        });
      }

      for (const commit of snapshot.commits) {
        hearPhrase(space, commit.text);
      }

      // Always wait full pause window so drainPause can succeed, then re-arm if needed
      armPauseFlush(space.code, PAUSE_MS);

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
      if (url) {
        publicBaseUrl = url;
        console.log(`  Public QR:      ${url}\n`);
        io.emit("network:public", { publicBaseUrl: url });
        return;
      }
      console.log(`  Public link unavailable. The QR will use the local address.\n`);
    });
  });
}

startListening(PORT);
