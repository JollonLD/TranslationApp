import { exec } from "node:child_process";

export function openAppWindow(url: string) {
  if (process.platform === "win32") {
    exec(`cmd /c start "" "${url}"`);
    return;
  }
  if (process.platform === "darwin") {
    exec(`open "${url}"`);
    return;
  }
  exec(`xdg-open "${url}"`);
}
