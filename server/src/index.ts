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
  claimHost,
  createSpace,
  endSpace,
  getSpace,
  normalizeCode,
  publicSpace,
  pushCaption,
  releaseHost,
  setLanguages,
  setListening,
} from "./spaces.js";
import { translateMany } from "./translate.js";
import { startPublicTunnel } from "./tunnel.js";
import { isLanguage, LANGUAGES, type Caption, type LanguageCode, type Space } from "./types.js";

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
  const items = space.lastPartial ? [...recent, space.lastPartial] : recent;
  let changed = false;
  await Promise.all(
    items.map(async (caption) => {
      const missing = targets.filter((lang) => !caption.translations[lang]);
      if (!missing.length) return;
      Object.assign(caption.translations, await translateMany(caption.original, space.sourceLang, missing));
      const first = missing.find((lang) => caption.translations[lang]);
      if (first && caption.translations[first]) {
        caption.translated = caption.translations[first]!;
      }
      changed = true;
    }),
  );
  return changed;
}

function makeCaption(
  text: string,
  translations: Caption["translations"],
  isFinal: boolean,
): Caption {
  const preferred =
    translations.en ||
    Object.values(translations).find((value) => value && value !== text) ||
    text;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    emitSpace(space.code);
  });

  socket.on(
    "transcript",
    async (payload: { code: string; text: string; isFinal: boolean }) => {
      const space = getSpace(payload.code);
      if (!space || space.hostId !== socket.id) return;

      const text = payload.text?.trim();
      if (!text) return;

      const requested = listenerTargets(space.code);
      const shouldTranslate = payload.isFinal || text.length > 8;
      const targets = shouldTranslate
        ? requested.length
          ? requested
          : LANGUAGES
        : [];
      const translations = await translateMany(text, space.sourceLang, targets);
      const caption = makeCaption(text, translations, Boolean(payload.isFinal));

      pushCaption(space, caption);
      io.to(roomName(space.code)).emit("caption", caption);
    },
  );

  socket.on("space:end", (payload: { code: string }) => {
    const space = getSpace(payload.code);
    if (!space || space.hostId !== socket.id) return;
    io.to(roomName(space.code)).emit("space:ended");
    io.in(roomName(space.code)).socketsLeave(roomName(space.code));
    endSpace(space.code);
  });

  socket.on("disconnect", () => {
    const released = releaseHost(socket.id);
    if (released) emitSpace(released.code);
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
