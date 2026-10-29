import { randomBytes } from "node:crypto";
import type { Caption, LanguageCode, Space, TranslateHealth } from "./types.js";

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
    hostTail: "",
    translateHealth: "ok",
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
      space.hostTail = "";
      return space;
    }
  }
  return undefined;
}

export function setListening(space: Space, listening: boolean) {
  space.listening = listening;
  if (!listening) {
    space.lastPartial = null;
    space.hostTail = "";
  }
}

export function setHostTail(space: Space, tail: string) {
  space.hostTail = tail.trim();
  if (!space.hostTail) {
    space.lastPartial = null;
    return;
  }
  space.lastPartial = {
    id: `tail-${space.code}`,
    original: space.hostTail,
    translated: space.hostTail,
    translations: { [space.sourceLang]: space.hostTail },
    isFinal: false,
    at: Date.now(),
  };
}

export function setTranslateHealth(space: Space, health: TranslateHealth) {
  space.translateHealth = health;
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
    const existingIndex = space.captions.findIndex((item) => item.id === caption.id);
    if (existingIndex >= 0) {
      const prev = space.captions[existingIndex];
      space.captions[existingIndex] = {
        ...prev,
        ...caption,
        translations: { ...prev.translations, ...caption.translations },
        translated: caption.translated || prev.translated,
        isFinal: true,
        live: false,
      };
    } else {
      const last = space.captions.at(-1);
      const sameOriginal =
        last &&
        last.original.trim().toLowerCase() === caption.original.trim().toLowerCase();
      const nested =
        last &&
        last.isFinal &&
        last.original.trim().toLowerCase().includes(caption.original.trim().toLowerCase()) &&
        caption.original.trim().split(/\s+/).length <= last.original.trim().split(/\s+/).length;
      if (last && (sameOriginal || nested)) {
        space.captions[space.captions.length - 1] = {
          ...last,
          translations: { ...caption.translations, ...last.translations },
          translated: last.translated || caption.translated,
          bibleRef: caption.bibleRef || last.bibleRef,
        };
      } else {
        space.captions.push({ ...caption, live: false });
      }
    }
    space.lastPartial = null;
    if (space.captions.length > 2000) {
      space.captions.splice(0, space.captions.length - 2000);
    }
    return;
  }

  space.lastPartial = caption;
}

/** In-place update of a frozen (or live) caption by id. */
export function updateCaption(space: Space, caption: Caption) {
  const index = space.captions.findIndex((item) => item.id === caption.id);
  if (index >= 0) {
    const prev = space.captions[index];
    space.captions[index] = {
      ...prev,
      ...caption,
      translations: { ...prev.translations, ...caption.translations },
      translated: caption.translated || prev.translated,
    };
    return space.captions[index];
  }
  if (!caption.isFinal) {
    space.lastPartial = {
      ...caption,
      translations: {
        ...(space.lastPartial?.translations ?? {}),
        ...caption.translations,
      },
    };
    return space.lastPartial;
  }
  space.captions.push(caption);
  return caption;
}

export function publicSpace(space: Space, listenerCount: number) {
  return {
    code: space.code,
    sourceLang: space.sourceLang,
    targetLang: space.targetLang,
    listening: space.listening,
    captions: space.captions,
    lastPartial: space.lastPartial,
    hostTail: space.hostTail,
    translateHealth: space.translateHealth,
    listenerCount,
    createdAt: space.createdAt,
  };
}

export function endSpace(code: string) {
  spaces.delete(normalizeCode(code));
}
