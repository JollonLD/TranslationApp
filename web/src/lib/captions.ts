import type { Caption } from "../types";

export function appendCaption(list: Caption[], caption: Caption): Caption[] {
  if (list.some((item) => item.id === caption.id)) return list;
  const last = list.at(-1);
  if (last && last.original === caption.original && last.translated === caption.translated) {
    return list;
  }
  return [...list, caption];
}

export function mergeSpaceCaptions(current: Caption[], incoming: Caption[]): Caption[] {
  if (incoming.length >= current.length) return incoming;
  const seen = new Set(incoming.map((item) => item.id));
  return [...incoming, ...current.filter((item) => !seen.has(item.id))];
}
