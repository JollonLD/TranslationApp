export type LanguageCode = "pt" | "en" | "es" | "it" | "fa" | "ur";

export type Caption = {
  id: string;
  original: string;
  translated: string;
  translations: Partial<Record<LanguageCode, string>>;
  isFinal: boolean;
  at: number;
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
};

export const LANGUAGES: LanguageCode[] = ["pt", "en", "es", "it", "fa", "ur"];

export function isLanguage(value: string | undefined): value is LanguageCode {
  return Boolean(value && (LANGUAGES as string[]).includes(value));
}

export function captionText(caption: Caption, lang: LanguageCode) {
  return caption.translations[lang] || caption.original;
}
