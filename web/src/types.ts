export type LanguageCode = "pt" | "en" | "es" | "it" | "fa" | "ur";

export type TranslateHealth = "ok" | "degraded" | "down";

export type Caption = {
  id: string;
  original: string;
  translated: string;
  translations?: Partial<Record<LanguageCode, string>>;
  isFinal: boolean;
  at: number;
  live?: boolean;
  bibleRef?: string;
};

export type SpaceState = {
  code: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  listening: boolean;
  captions: Caption[];
  lastPartial: Caption | null;
  hostTail?: string;
  translateHealth?: TranslateHealth;
  listenerCount: number;
  createdAt: number;
};

export const LANGUAGES: LanguageCode[] = ["pt", "en", "es", "it", "fa", "ur"];

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
  it: "Italian",
  fa: "Persian · فارسی",
  ur: "Urdu · اردو",
};

export const SPEECH_LOCALES: Record<LanguageCode, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
  it: "it-IT",
  fa: "fa-IR",
  ur: "ur-PK",
};

export const RTL_LANGUAGES = new Set<LanguageCode>(["fa", "ur"]);

export function isLanguage(value: string | undefined | null): value is LanguageCode {
  return Boolean(value && (LANGUAGES as string[]).includes(value));
}

export function captionText(caption: Caption, lang: LanguageCode) {
  return caption.translations?.[lang] || caption.original;
}

export function preferredReadLang(): LanguageCode {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem("palavra-read-lang");
  if (isLanguage(saved)) return saved;
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("fa") || nav.startsWith("per")) return "fa";
  if (nav.startsWith("ur")) return "ur";
  if (nav.startsWith("pt")) return "pt";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("it")) return "it";
  return "en";
}
