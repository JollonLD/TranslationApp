export type LanguageCode = "pt" | "en" | "es" | "it";

export type Caption = {
  id: string;
  original: string;
  translated: string;
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

export const LANGUAGES: LanguageCode[] = ["pt", "en", "es", "it"];
