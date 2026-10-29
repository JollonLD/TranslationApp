import type { Caption } from "../types";

function mergeCaption(current: Caption, incoming: Caption): Caption {
  return {
    ...current,
    ...incoming,
    translations: { ...current.translations, ...incoming.translations },
    translated: incoming.translated || current.translated,
    original: incoming.original || current.original,
    bibleRef: incoming.bibleRef || current.bibleRef,
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
  if (last && last.isFinal && caption.isFinal) {
    const a = last.original.trim().toLowerCase();
    const b = caption.original.trim().toLowerCase();
    if (a === b || (a.includes(b) && b.split(/\s+/).length <= a.split(/\s+/).length)) {
      const next = [...list];
      next[next.length - 1] = mergeCaption(last, caption);
      return next;
    }
  }
  return [...list, caption];
}

export function updateCaption(list: Caption[], caption: Caption): Caption[] {
  const existingIndex = list.findIndex((item) => item.id === caption.id);
  if (existingIndex < 0) return appendCaption(list, caption);
  const next = [...list];
  next[existingIndex] = mergeCaption(next[existingIndex], caption);
  return next;
}

export function mergeSpaceCaptions(current: Caption[], incoming: Caption[]): Caption[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const mergedIncoming = incoming.map((item) => {
    const prev = currentById.get(item.id);
    return prev ? mergeCaption(prev, item) : item;
  });

  const seen = new Set(mergedIncoming.map((item) => item.id));
  const extras = current.filter((item) => item.isFinal && !seen.has(item.id));
  if (!extras.length) return mergedIncoming;

  const byOriginal = new Set(mergedIncoming.map((item) => item.original));
  const uniqueExtras = extras.filter((item) => !byOriginal.has(item.original));
  return [...mergedIncoming, ...uniqueExtras].sort((a, b) => a.at - b.at);
}
