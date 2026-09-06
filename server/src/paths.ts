import { existsSync } from "node:fs";
import path from "node:path";

function isBundledExe() {
  const name = path.basename(process.execPath);
  return /\.exe$/i.test(name) && !/^node(\.exe)?$/i.test(name);
}

export function resourceDir() {
  if (process.env.PALAVRA_HOME) return path.resolve(process.env.PALAVRA_HOME);
  if (isBundledExe()) return path.dirname(process.execPath);

  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "web", "dist", "index.html"))) return cwd;
  if (existsSync(path.join(cwd, "..", "web", "dist", "index.html"))) {
    return path.resolve(cwd, "..");
  }
  return cwd;
}

export function webDistDir() {
  return path.join(resourceDir(), "web", "dist");
}

export function cloudflaredPath() {
  const root = resourceDir();
  const windows = path.join(root, "cloudflared.exe");
  const unix = path.join(root, "cloudflared");
  if (process.platform === "win32" && existsSync(windows)) return windows;
  if (existsSync(unix)) return unix;
  return null;
}
