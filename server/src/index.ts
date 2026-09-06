import { createServer } from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { openAppWindow } from "./desktop.js";
import { firewallHint } from "./firewall.js";
import { getLanAddresses, localHostname, primaryLanAddress } from "./network.js";
import { webDistDir } from "./paths.js";
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
import { translateText } from "./translate.js";
import { startPublicTunnel } from "./tunnel.js";
import type { LanguageCode } from "./types.js";

let publicBaseUrl = "";

function viewerLink(code: string) {
  if (publicBaseUrl) return `${publicBaseUrl.replace(/\/$/, "")}/ouvir/${code}`;
  return `http://${primaryLanAddress()}:${PORT}/ouvir/${code}`;
}

const PORT = Number(process.env.PORT ?? 3000);
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
      payload: { code: string; role?: "host" | "listener" },
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
      emitSpace(space.code);
      ack?.({
        ok: true,
        space: publicSpace(space, Math.max(0, listenerCount(space.code) - (space.hostId ? 1 : 0))),
        publicUrl: viewerLink(space.code),
        publicBaseUrl: publicBaseUrl || null,
      });
    },
  );

  socket.on(
    "space:languages",
    (payload: { code: string; sourceLang: LanguageCode; targetLang: LanguageCode }) => {
      const space = getSpace(payload.code);
      if (!space || space.hostId !== socket.id) return;
      setLanguages(space, payload.sourceLang, payload.targetLang);
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

      const translated = payload.isFinal || text.length > 8
        ? await translateText(text, space.sourceLang, space.targetLang)
        : "";

      const caption = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original: text,
        translated: translated || text,
        isFinal: Boolean(payload.isFinal),
        at: Date.now(),
      };

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

httpServer.listen(PORT, "0.0.0.0", () => {
  const lan = getLanAddresses();
  console.log(`\n  Palavra está no ar`);
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  for (const address of lan) {
    console.log(`  Na rede local:      http://${address}:${PORT}`);
  }
  console.log(`  Opening the public QR link…`);
  openAppWindow(`http://localhost:${PORT}`);

  const tunnel = startPublicTunnel(PORT);
  void tunnel.ready.then((url) => {
    if (url) {
      publicBaseUrl = url;
      console.log(`  QR público:         ${url}\n`);
      io.emit("network:public", { publicBaseUrl: url });
      return;
    }
    console.log(`  Sem túnel público. O QR usará o IP local.\n`);
  });
});
