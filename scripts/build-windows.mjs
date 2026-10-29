import { execSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const pythonVersion = "3.12.10";
const pythonZip = `python-${pythonVersion}-embed-amd64.zip`;
const pythonUrl = `https://www.python.org/ftp/python/${pythonVersion}/${pythonZip}`;

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

console.log("Downloading embeddable Python for Windows…");
const pyDir = path.join(outDir, "python");
await mkdir(pyDir, { recursive: true });
const pyZip = path.join(root, ".cache", pythonZip);
await download(pythonUrl, pyZip);
if (!existsSync(path.join(pyDir, "python.exe"))) {
  run(`unzip -qo "${pyZip}" -d "${pyDir}"`);
}
const pthName = (await readdir(pyDir)).find((name) => name.endsWith("._pth"));
if (!pthName) throw new Error("Python embeddable zip has no ._pth file");
const pthPath = path.join(pyDir, pthName);
let pth = await readFile(pthPath, "utf8");
pth = pth.replace(/^#\s*import site/m, "import site");
if (!pth.includes("Lib\\site-packages") && !pth.includes("Lib/site-packages")) {
  pth = `${pth.trim()}\nLib\\site-packages\n`;
}
if (!/^import site/m.test(pth)) pth = `${pth.trim()}\nimport site\n`;
await writeFile(pthPath, pth, "utf8");
await mkdir(path.join(pyDir, "Lib", "site-packages"), { recursive: true });

console.log("Installing Windows wheels (CPU torch, WhisperLiveKit, transformers)…");
const hostPy = path.join(root, ".cache", "pip-host");
if (!existsSync(path.join(hostPy, "bin", "pip"))) {
  run(`python3 -m venv "${hostPy}"`);
  run(`"${path.join(hostPy, "bin", "pip")}" install -U pip`);
}
const pip = path.join(hostPy, "bin", "pip");
const site = path.join(pyDir, "Lib", "site-packages");
const pipTarget = [
  "install",
  "--target",
  site,
  "--platform",
  "win_amd64",
  "--python-version",
  "3.12",
  "--implementation",
  "cp",
  "--only-binary=:all:",
  "--upgrade",
];
run(
  `"${pip}" ${pipTarget.join(" ")} torch torchaudio --index-url https://download.pytorch.org/whl/cpu`,
);
// WhisperLiveKit depends on torch, but the CPU build is versioned 2.x+cpu,
// which pip treats as older than 2.x and would replace with the CUDA wheel.
run(
  `"${pip}" ${pipTarget.join(" ")} --no-deps whisperlivekit`,
);
run(
  `"${pip}" ${pipTarget.join(" ")} fastapi uvicorn websockets huggingface-hub faster-whisper tqdm tiktoken python-multipart starlette librosa soundfile "transformers>=4.46" sentencepiece protobuf safetensors`,
);

console.log("Downloading Whisper small and NLLB 600M…");
const models = path.join(outDir, "models");
const hf = path.join(models, "hf");
const nllb = path.join(models, "nllb");
await mkdir(hf, { recursive: true });
await mkdir(nllb, { recursive: true });
run(`"${path.join(hostPy, "bin", "pip")}" install -q huggingface_hub`);
const fetchModels = spawnSync(
  path.join(hostPy, "bin", "python"),
  [
    "-c",
    [
      "from huggingface_hub import snapshot_download",
      `snapshot_download(repo_id="Systran/faster-whisper-small", cache_dir=${JSON.stringify(hf)})`,
      `snapshot_download(repo_id="facebook/nllb-200-distilled-600M", local_dir=${JSON.stringify(nllb)})`,
      "print('models ready')",
    ].join("\n"),
  ],
  { stdio: "inherit" },
);
if (fetchModels.status !== 0) {
  throw new Error("Model download failed");
}

console.log("Copying ASR worker…");
await mkdir(path.join(outDir, "asr"), { recursive: true });
await cp(path.join(root, "server", "asr", "nllb_worker.py"), path.join(outDir, "asr", "nllb_worker.py"));

console.log("Copying web files and launcher…");
await rm(path.join(outDir, "web"), { recursive: true, force: true });
await rm(path.join(outDir, "Palavra.bat"), { force: true });
await rm(path.join(outDir, "Palavra.exe"), { force: true });
await rm(path.join(outDir, "ChiesaIlFaro.exe"), { force: true });
await cp(path.join(root, "web", "dist"), path.join(outDir, "web", "dist"), {
  recursive: true,
});
await cp(path.join(root, "scripts", "ChiesaIlFaro.bat"), path.join(outDir, "ChiesaIlFaro.bat"));
if (existsSync(path.join(root, ".env"))) {
  await cp(path.join(root, ".env"), path.join(outDir, ".env"));
}

await writeFile(
  path.join(outDir, "START.txt"),
  [
    "Chiesa Il Faro for Windows",
    "",
    "1. Copy this WHOLE folder to the church computer (Python and models are inside).",
    "2. Double-click ChiesaIlFaro.bat",
    "3. A black window must stay open. If it closes, open palavra.log.",
    "4. If Windows asks about the firewall, choose Allow.",
    "5. Chrome or Edge should open. The status line should say Whisper. Click Start and show the QR.",
    "",
    "The booth listens with WhisperLiveKit (small) and translates Persian/Urdu with NLLB.",
    "If python\\python.exe is missing, the booth falls back to Chrome speech recognition.",
    "Put NVIDIA_API_KEY in a .env file in this folder for English, Spanish, and Italian.",
    "",
    "Do not move ChiesaIlFaro.bat away from this folder.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\nWindows package ready: ${outDir}`);
console.log("On Windows, double-click ChiesaIlFaro.bat inside that folder.");
