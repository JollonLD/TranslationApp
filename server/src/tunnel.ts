import { spawn, type ChildProcess } from "node:child_process";
import { cloudflaredPath } from "./paths.js";

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function startPublicTunnel(port: number) {
  let child: ChildProcess | null = null;
  let settled = false;

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
      const match = chunk.toString().match(TUNNEL_URL);
      if (match) finish(match[0]);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));

    setTimeout(() => finish(null), 45000);
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
