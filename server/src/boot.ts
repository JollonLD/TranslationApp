import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resourceDir } from "./paths.js";

/** Load KEY=VALUE from .env without adding a dependency (NVIDIA_API_KEY, etc.). */
export function loadEnvFile() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(resourceDir(), ".env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, "utf8");
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
      return file;
    } catch {
      /* try next */
    }
  }
  return null;
}

function logFile() {
  return path.join(resourceDir(), "palavra.log");
}

export function writeLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    appendFileSync(logFile(), line);
  } catch {
    /* ignore */
  }
  console.error(message);
}

export function holdWindow() {
  console.log("\nPress Enter to close…");
  try {
    if (process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", () => process.exit(1));
      return;
    }
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(1), 30000);
}

export function installCrashGuard() {
  process.on("uncaughtException", (error) => {
    writeLog(`uncaughtException: ${error.stack || error.message}`);
    holdWindow();
  });
  process.on("unhandledRejection", (reason) => {
    writeLog(`unhandledRejection: ${String(reason)}`);
  });
}
