export type LanguageCode = "pt" | "en" | "es" | "it";

export type Caption = {
  id: string;
  original: string;
  translated: string;
  isFinal: boolean;
  at: number;
};

export type SpaceState = {
  code: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  listening: boolean;
  captions: Caption[];
  lastPartial: Caption | null;
  listenerCount: number;
  createdAt: number;
};

export const LANGUAGES: LanguageCode[] = ["pt", "en", "es", "it"];

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
  it: "Italian",
};

export const SPEECH_LOCALES: Record<LanguageCode, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
  it: "it-IT",
};
