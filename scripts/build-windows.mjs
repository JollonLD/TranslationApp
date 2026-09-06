import { execSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-windows");
const cloudflaredUrl =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

function run(command) {
  execSync(command, { cwd: root, stdio: "inherit" });
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  await pipeline(response.body, createWriteStream(dest));
}

await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "web"), { recursive: true });

console.log("Building web UI…");
run("npm run build -w web");

console.log("Bundling server…");
run(
  "npx --yes esbuild server/src/index.ts --bundle --platform=node --format=cjs --outfile=dist-windows/server.cjs",
);

console.log("Downloading cloudflared for Windows…");
await download(cloudflaredUrl, path.join(outDir, "cloudflared.exe"));

console.log("Copying web files…");
await cp(path.join(root, "web", "dist"), path.join(outDir, "web", "dist"), {
  recursive: true,
});

console.log("Creating Palavra.exe…");
run(
  `npx --yes @yao-pkg/pkg dist-windows/server.cjs --targets node22-win-x64 --output dist-windows/Palavra.exe`,
);

await writeFile(
  path.join(outDir, "START.txt"),
  [
    "Palavra for Windows",
    "",
    "1. Copy this whole folder to the church computer.",
    "2. Double-click Palavra.exe.",
    "3. Windows may ask to allow the app on the network — choose Allow.",
    "4. Chrome or Edge opens. Use Start, then show the QR.",
    "",
    "Keep this window open while the service is running.",
    "Do not separate Palavra.exe from the web folder or cloudflared.exe.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\nWindows package ready: ${outDir}`);
console.log("Copy the entire dist-windows folder to the PC, then open Palavra.exe.");
