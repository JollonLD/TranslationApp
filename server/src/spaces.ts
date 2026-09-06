import { randomBytes } from "node:crypto";
import type { Caption, LanguageCode, Space } from "./types.js";

const spaces = new Map<string, Space>();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode(): string {
  const bytes = randomBytes(4);
  let suffix = "";
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }
  return `IGREJA-${suffix}`;
}

export function createSpace(
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): Space {
  let code = createCode();
  while (spaces.has(code)) code = createCode();

  const space: Space = {
    code,
    sourceLang,
    targetLang,
    hostId: null,
    listening: false,
    createdAt: Date.now(),
    captions: [],
    lastPartial: null,
  };

  spaces.set(code, space);
  return space;
}

export function getSpace(code: string): Space | undefined {
  return spaces.get(normalizeCode(code));
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function claimHost(space: Space, socketId: string): boolean {
  if (space.hostId && space.hostId !== socketId) return false;
  space.hostId = socketId;
  return true;
}

export function releaseHost(socketId: string): Space | undefined {
  for (const space of spaces.values()) {
    if (space.hostId === socketId) {
      space.hostId = null;
      space.listening = false;
      space.lastPartial = null;
      return space;
    }
  }
  return undefined;
}

export function setListening(space: Space, listening: boolean) {
  space.listening = listening;
  if (!listening) space.lastPartial = null;
}

export function setLanguages(
  space: Space,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
) {
  space.sourceLang = sourceLang;
  space.targetLang = targetLang;
}

export function pushCaption(space: Space, caption: Caption) {
  if (caption.isFinal) {
    const last = space.captions.at(-1);
    if (last && last.original === caption.original) {
      space.captions[space.captions.length - 1] = caption;
    } else {
      space.captions.push(caption);
    }
    space.lastPartial = null;
    if (space.captions.length > 2000) {
      space.captions.splice(0, space.captions.length - 2000);
    }
    return;
  }

  space.lastPartial = caption;
}

export function publicSpace(space: Space, listenerCount: number) {
  return {
    code: space.code,
    sourceLang: space.sourceLang,
    targetLang: space.targetLang,
    listening: space.listening,
    captions: space.captions,
    lastPartial: space.lastPartial,
    listenerCount,
    createdAt: space.createdAt,
  };
}

export function endSpace(code: string) {
  spaces.delete(normalizeCode(code));
}
