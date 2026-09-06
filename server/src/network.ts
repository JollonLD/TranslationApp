import { hostname, networkInterfaces } from "node:os";

export function getLanAddresses(): string[] {
  const nets = networkInterfaces();
  const addresses: string[] = [];

  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push(entry.address);
    }
  }

  return addresses;
}

export function primaryLanAddress(): string {
  return getLanAddresses()[0] ?? "127.0.0.1";
}

export function localHostname(): string {
  return hostname();
}
