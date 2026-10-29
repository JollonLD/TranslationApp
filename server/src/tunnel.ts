import { spawn, type ChildProcess } from "node:child_process";
import { cloudflaredPath } from "./paths.js";

/** Quick-tunnel hostnames — never treat api/www as the public booth URL. */
const RESERVED_CF_HOSTS = new Set(["api", "www", "dash", "developers", "one", "cloudflare"]);
const TUNNEL_URL = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;

/** Pick the real trycloudflare visitor URL from cloudflared logs (skip api.trycloudflare.com). */
export function extractTunnelUrl(text: string): string | null {
  let best: string | null = null;
  TUNNEL_URL.lastIndex = 0;
  for (const match of text.matchAll(TUNNEL_URL)) {
    const subdomain = match[1].toLowerCase();
    if (RESERVED_CF_HOSTS.has(subdomain)) continue;
    // Quick tunnels look like adjective-noun-adjective (hyphenated, longer)
    if (!best || match[0].length > best.length) best = match[0];
  }
  return best;
}

export function startPublicTunnel(port: number) {
  let child: ChildProcess | null = null;
  let settled = false;
  let logBuffer = "";

  const ready = new Promise<string | null>((resolve) => {
    if (process.env.PALAVRA_NO_TUNNEL === "1") {
      resolve(null);
      return;
    }

    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      resolve(url);
    };

    const bundled = cloudflaredPath();
    child = bundled
      ? spawn(bundled, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(
          "npx",
          ["--yes", "cloudflared", "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
          { stdio: ["ignore", "pipe", "pipe"] },
        );

    const onChunk = (chunk: Buffer) => {
      logBuffer += chunk.toString();
      // Keep buffer bounded
      if (logBuffer.length > 50_000) logBuffer = logBuffer.slice(-30_000);
      const url = extractTunnelUrl(logBuffer);
      if (url) finish(url);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", () => finish(null));
    child.on("exit", () => finish(extractTunnelUrl(logBuffer)));

    setTimeout(() => finish(extractTunnelUrl(logBuffer)), 45000);
  });

  const stop = () => {
    child?.kill("SIGTERM");
  };

  process.once("exit", stop);
  process.once("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  return { ready, stop };
}
