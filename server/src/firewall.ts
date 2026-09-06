import { execSync } from "node:child_process";

export function firewallHint(): string | null {
  try {
    const status = execSync("systemctl is-active ufw", {
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    if (status === "active") {
      return "sudo ufw allow 3000/tcp";
    }
  } catch {
    return null;
  }
  return null;
}
