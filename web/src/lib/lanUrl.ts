function isLoopback(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isUsableBase(base: string) {
  try {
    const url = new URL(base);
    return !isLoopback(url.hostname);
  } catch {
    return false;
  }
}

export function viewerUrl(code: string, publicBase: string, lanIp: string, port = 3000) {
  const base = publicBase.replace(/\/$/, "");
  if (base && isUsableBase(base)) {
    return `${base}/ouvir/${code}`;
  }

  const pageHost = window.location.hostname;
  const host = pageHost && !isLoopback(pageHost) ? pageHost : lanIp;
  if (!host || isLoopback(host)) return "";
  const protocol = window.location.protocol === "https:" ? "https" : "http";
  const pagePort = window.location.port;
  if (!isLoopback(pageHost) && pageHost) {
    return pagePort
      ? `${protocol}//${pageHost}:${pagePort}/ouvir/${code}`
      : `${protocol}//${pageHost}/ouvir/${code}`;
  }
  return `http://${host}:${port}/ouvir/${code}`;
}
