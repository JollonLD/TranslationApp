import type { Caption } from "../types";

function mergeCaption(current: Caption, incoming: Caption): Caption {
  return {
    ...current,
    ...incoming,
    translations: { ...current.translations, ...incoming.translations },
    translated: incoming.translated || current.translated,
  };
}

export function appendCaption(list: Caption[], caption: Caption): Caption[] {
  const existingIndex = list.findIndex((item) => item.id === caption.id);
  if (existingIndex >= 0) {
    const next = [...list];
    next[existingIndex] = mergeCaption(next[existingIndex], caption);
    return next;
  }
  const last = list.at(-1);
  if (last && last.original === caption.original) {
    const next = [...list];
    next[next.length - 1] = mergeCaption(last, caption);
    return next;
  }
  return [...list, caption];
}

export function mergeSpaceCaptions(current: Caption[], incoming: Caption[]): Caption[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const mergedIncoming = incoming.map((item) => {
    const prev = currentById.get(item.id);
    return prev ? mergeCaption(prev, item) : item;
  });
  if (incoming.length >= current.length) return mergedIncoming;
  const seen = new Set(incoming.map((item) => item.id));
  return [...mergedIncoming, ...current.filter((item) => !seen.has(item.id))];
}
