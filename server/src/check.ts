import { io } from "socket.io-client";
import { translateText } from "./translate.js";

const base = process.env.PALAVRA_URL ?? "http://127.0.0.1:3000";

async function main() {
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  const network = await fetch(`${base}/api/network`).then((r) => r.json()) as {
    primary: string;
    port: number;
    addresses: string[];
  };

  const lanUrl = `http://${network.primary}:${network.port}/`;
  const lanHome = await fetch(lanUrl);
  const lanListen = await fetch(`${lanUrl}ouvir/TESTE`);

  const ptEn = await translateText("A paz do Senhor, irmãos", "pt", "en");
  const ptIt = await translateText("A paz do Senhor, irmãos", "pt", "it");
  const itPt = await translateText("La pace del Signore", "it", "pt");

  const host = io(base, { transports: ["polling", "websocket"] });
  await new Promise<void>((resolve, reject) => {
    host.on("connect", () => resolve());
    host.on("connect_error", reject);
    setTimeout(() => reject(new Error("host timeout")), 5000);
  });

  const created = await new Promise<{ ok: boolean; space?: { code: string }; publicUrl?: string }>((resolve) => {
    host.emit("space:create", { sourceLang: "pt", targetLang: "it" }, resolve);
  });

  if (!created.ok || !created.space) throw new Error("create failed");

  const viewer = io(base, { transports: ["polling", "websocket"] });
  await new Promise<void>((resolve, reject) => {
    viewer.on("connect", () => resolve());
    viewer.on("connect_error", reject);
    setTimeout(() => reject(new Error("viewer timeout")), 5000);
  });

  const joined = await new Promise<{ ok: boolean }>((resolve) => {
    viewer.emit("space:join", { code: created.space?.code, role: "listener", targetLang: "it" }, resolve);
  });

  const caption = await new Promise<{
    original: string;
    translated: string;
    translations?: Record<string, string>;
  }>((resolve, reject) => {
    viewer.once("caption", resolve);
    host.emit("transcript", {
      code: created.space?.code,
      text: "Bem-vindos ao culto desta noite",
      isFinal: true,
    });
    setTimeout(() => reject(new Error("caption timeout")), 12000);
  });

  host.emit("space:end", { code: created.space.code });
  host.close();
  viewer.close();

  const report = {
    health,
    lanHome: lanHome.status,
    lanListen: lanListen.status,
    publicUrl: created.publicUrl,
    qrLooksLocalhost: Boolean(created.publicUrl?.includes("localhost")),
    joined: joined.ok,
    ptEn,
    ptIt,
    itPt,
    liveOriginal: caption.original,
    liveTranslated: caption.translations?.it || caption.translated,
    translatedAwayFromPortuguese:
      (caption.translations?.it || caption.translated).toLowerCase() !== caption.original.toLowerCase(),
  };

  console.log(JSON.stringify(report, null, 2));

  if (lanHome.status !== 200 || lanListen.status !== 200) {
    throw new Error("LAN pages failed");
  }
  if (report.qrLooksLocalhost) throw new Error("QR URL uses localhost");
  if (!report.translatedAwayFromPortuguese) throw new Error("translation stayed in Portuguese");
  if (!/pace|signore|benvenut|sera/i.test(ptIt) && ptIt === "A paz do Senhor, irmãos") {
    throw new Error("Italian translation failed");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
