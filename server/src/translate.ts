import type { LanguageCode } from "./types.js";

const cache = new Map<string, string>();

const MYMEMORY_LOCALE: Record<LanguageCode, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
  it: "it-IT",
  fa: "fa-IR",
  ur: "ur-PK",
};

const GLOSSARY: Record<string, Partial<Record<LanguageCode, string>>> = {
  irmãos: { en: "brothers and sisters", es: "hermanos", it: "fratelli", fa: "برادران", ur: "بھائیو" },
  irmãs: { en: "sisters", es: "hermanas", it: "sorelle", fa: "خواهران", ur: "بہنیں" },
  louvor: { en: "worship", es: "alabanza", it: "lode", fa: "پرستش", ur: "عبادت" },
  culto: { en: "service", es: "culto", it: "culto", fa: "عبادت", ur: "عبادت" },
  pastor: { en: "pastor", es: "pastor", it: "pastore", fa: "شبان", ur: "پادری" },
  amém: { en: "amen", es: "amén", it: "amen", fa: "آمین", ur: "آمین" },
  aleluia: { en: "hallelujah", es: "aleluya", it: "alleluia", fa: "هللویاه", ur: "ہللویاہ" },
  oração: { en: "prayer", es: "oración", it: "preghiera", fa: "دعا", ur: "دعا" },
  palavra: { en: "the Word", es: "la Palabra", it: "la Parola", fa: "کلام", ur: "کلام" },
  evangelho: { en: "gospel", es: "evangelio", it: "vangelo", fa: "انجیل", ur: "انجیل" },
  igreja: { en: "church", es: "iglesia", it: "chiesa", fa: "کلیسا", ur: "کلیسا" },
  "brothers and sisters": { pt: "irmãos" },
  sisters: { pt: "irmãs" },
  worship: { pt: "louvor" },
  prayer: { pt: "oração" },
  gospel: { pt: "evangelho" },
  church: { pt: "igreja" },
  hermanos: { pt: "irmãos" },
  hermanas: { pt: "irmãs" },
  alabanza: { pt: "louvor" },
  oración: { pt: "oração" },
  evangelio: { pt: "evangelho" },
  iglesia: { pt: "igreja" },
  fratelli: { pt: "irmãos" },
  sorelle: { pt: "irmãs" },
  lode: { pt: "louvor" },
  preghiera: { pt: "oração" },
  vangelo: { pt: "evangelho" },
  chiesa: { pt: "igreja" },
};

function cacheKey(text: string, source: LanguageCode, target: LanguageCode) {
  return `${source}|${target}|${text.trim().toLowerCase()}`;
}

function glossaryHint(text: string, target: LanguageCode): string | null {
  const key = text.trim().toLowerCase().replace(/[.,!?…]+$/g, "");
  return GLOSSARY[key]?.[target] ?? null;
}

async function translateMyMemory(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  const pairs = [
    `${MYMEMORY_LOCALE[source]}|${MYMEMORY_LOCALE[target]}`,
    `${source}|${target}`,
  ];

  for (const langpair of pairs) {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text.slice(0, 500));
    url.searchParams.set("langpair", langpair);
    url.searchParams.set("de", process.env.MYMEMORY_EMAIL ?? "palavra.igreja@gmail.com");

    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) continue;

    const data = (await response.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };

    const translated = data.responseData?.translatedText?.trim();
    if (!translated || /MYMEMORY WARNING/i.test(translated)) continue;
    if (Number(data.responseStatus) !== 200) continue;

    const cleaned = translated.trim();
    if (cleaned && cleaned.toLowerCase() !== text.toLowerCase()) return cleaned;
    if (cleaned) return cleaned;
  }

  return null;
}

async function translateGoogle(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text.slice(0, 500));

  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) return null;

  const data = (await response.json()) as Array<Array<Array<string>> | unknown>;
  const chunks = data[0];
  if (!Array.isArray(chunks)) return null;

  const translated = chunks
    .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ""))
    .join("")
    .trim();

  return translated || null;
}

export async function translateText(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (source === target) return trimmed;

  const key = cacheKey(trimmed, source, target);
  const cached = cache.get(key);
  if (cached) return cached;

  const hinted = glossaryHint(trimmed, target);
  if (hinted) {
    cache.set(key, hinted);
    return hinted;
  }

  try {
    const translated =
      (await translateMyMemory(trimmed, source, target)) ??
      (await translateGoogle(trimmed, source, target));

    if (!translated) return trimmed;
    cache.set(key, translated);
    return translated;
  } catch {
    return trimmed;
  }
}

export async function translateMany(
  text: string,
  source: LanguageCode,
  targets: LanguageCode[],
): Promise<Partial<Record<LanguageCode, string>>> {
  const translations: Partial<Record<LanguageCode, string>> = {
    [source]: text,
  };
  const unique = [...new Set(targets)].filter((lang) => lang !== source);
  await Promise.all(
    unique.map(async (lang) => {
      translations[lang] = await translateText(text, source, lang);
    }),
  );
  return translations;
}
