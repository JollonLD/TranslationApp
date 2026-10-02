import { appendFileSync } from "node:fs";
import path from "node:path";
import { resourceDir } from "./paths.js";

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
