export type LanguageCode = "pt" | "en" | "es" | "it" | "fa" | "ur";

export type TranslateHealth = "ok" | "degraded" | "down";

export type Caption = {
  id: string;
  original: string;
  translated: string;
  translations: Partial<Record<LanguageCode, string>>;
  isFinal: boolean;
  at: number;
  /** Open re-translating line (not yet frozen). */
  live?: boolean;
  /** Detected scripture reference chip, e.g. "João 3:16". */
  bibleRef?: string;
};

export type Space = {
  code: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  hostId: string | null;
  listening: boolean;
  createdAt: number;
  captions: Caption[];
  lastPartial: Caption | null;
  hostTail: string;
  translateHealth: TranslateHealth;
};

export const LANGUAGES: LanguageCode[] = ["pt", "en", "es", "it", "fa", "ur"];

export function isLanguage(value: string | undefined): value is LanguageCode {
  return Boolean(value && (LANGUAGES as string[]).includes(value));
}

export function captionText(caption: Caption, lang: LanguageCode) {
  return caption.translations[lang] || caption.original;
}
