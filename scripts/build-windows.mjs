import { execSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-windows");
const nodeVersion = "v22.18.0";
const nodeZip = `node-${nodeVersion}-win-x64.zip`;
const nodeUrl = `https://nodejs.org/dist/${nodeVersion}/${nodeZip}`;
const cloudflaredUrl =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: "inherit" });
}

async function download(url, dest) {
  if (existsSync(dest)) return;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  await pipeline(response.body, createWriteStream(dest));
}

await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "web"), { recursive: true });
await mkdir(path.join(outDir, "node"), { recursive: true });
await mkdir(path.join(root, ".cache"), { recursive: true });

console.log("Building web UI…");
run("npm run build -w web");

console.log("Bundling server…");
run(
  "npx --yes esbuild server/src/index.ts --bundle --platform=node --format=cjs --outfile=dist-windows/server.cjs",
);

console.log("Downloading portable Node for Windows…");
const zipPath = path.join(root, ".cache", nodeZip);
await download(nodeUrl, zipPath);
run(`unzip -qo "${zipPath}" -d "${path.join(root, ".cache")}"`);
await cp(
  path.join(root, ".cache", `node-${nodeVersion}-win-x64`, "node.exe"),
  path.join(outDir, "node", "node.exe"),
);

console.log("Downloading cloudflared for Windows…");
await download(cloudflaredUrl, path.join(outDir, "cloudflared.exe"));

console.log("Copying web files and launcher…");
await rm(path.join(outDir, "web"), { recursive: true, force: true });
await rm(path.join(outDir, "Palavra.bat"), { force: true });
await rm(path.join(outDir, "Palavra.exe"), { force: true });
await rm(path.join(outDir, "ChiesaIlFaro.exe"), { force: true });
await cp(path.join(root, "web", "dist"), path.join(outDir, "web", "dist"), {
  recursive: true,
});
await cp(path.join(root, "scripts", "ChiesaIlFaro.bat"), path.join(outDir, "ChiesaIlFaro.bat"));

await writeFile(
  path.join(outDir, "START.txt"),
  [
    "Chiesa Il Faro for Windows",
    "",
    "1. Copy this WHOLE folder to the church computer.",
    "2. Double-click ChiesaIlFaro.bat",
    "3. A black window must stay open. If it closes, open palavra.log.",
    "4. If Windows asks about the firewall, choose Allow.",
    "5. Chrome or Edge should open. Click Start and show the QR.",
    "",
    "Do not move ChiesaIlFaro.bat away from this folder.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\nWindows package ready: ${outDir}`);
console.log("On Windows, double-click ChiesaIlFaro.bat inside that folder.");
