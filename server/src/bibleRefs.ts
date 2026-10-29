/**
 * Detect spoken Bible references and fetch a short canonical verse when possible.
 */
import { polishChurchTerms } from "./churchGlossary.js";
import type { LanguageCode } from "./types.js";

export type BibleHit = {
  /** Display reference in source language, e.g. "João 3:16" */
  ref: string;
  /** english book slug for APIs */
  bookEn: string;
  chapter: number;
  verse: number;
  verseEnd?: number;
};

/** Portuguese / English book names → bible-api / common English name */
const BOOK_MAP: Array<{ match: RegExp; en: string; display: Partial<Record<LanguageCode, string>> }> = [
  { match: /\bg[eê]nesis\b|\bgenesis\b/i, en: "Genesis", display: { pt: "Gênesis", en: "Genesis", es: "Génesis", it: "Genesi" } },
  { match: /\b[eê]xodo\b|\bexodus\b/i, en: "Exodus", display: { pt: "Êxodo", en: "Exodus", es: "Éxodo", it: "Esodo" } },
  { match: /\blev[ií]tico\b|\bleviticus\b/i, en: "Leviticus", display: { pt: "Levítico", en: "Leviticus" } },
  { match: /\bn[uú]meros\b|\bnumbers\b/i, en: "Numbers", display: { pt: "Números", en: "Numbers" } },
  { match: /\bdeuteron[oô]mio\b|\bdeuteronomy\b/i, en: "Deuteronomy", display: { pt: "Deuteronômio", en: "Deuteronomy" } },
  { match: /\bjoshua\b|\bjosu[eé]\b/i, en: "Joshua", display: { pt: "Josué", en: "Joshua" } },
  { match: /\bjudges\b|\bju[ií]zes\b/i, en: "Judges", display: { pt: "Juízes", en: "Judges" } },
  { match: /\bruth\b|\brute\b/i, en: "Ruth", display: { pt: "Rute", en: "Ruth" } },
  { match: /\b1\s*samuel\b/i, en: "1 Samuel", display: { pt: "1 Samuel", en: "1 Samuel" } },
  { match: /\b2\s*samuel\b/i, en: "2 Samuel", display: { pt: "2 Samuel", en: "2 Samuel" } },
  { match: /\b1\s*reis\b|\b1\s*kings\b/i, en: "1 Kings", display: { pt: "1 Reis", en: "1 Kings" } },
  { match: /\b2\s*reis\b|\b2\s*kings\b/i, en: "2 Kings", display: { pt: "2 Reis", en: "2 Kings" } },
  { match: /\bsalmos?\b|\bpsalms?\b/i, en: "Psalm", display: { pt: "Salmo", en: "Psalm", es: "Salmo", it: "Salmo" } },
  { match: /\bprov[eé]rbios\b|\bproverbs\b/i, en: "Proverbs", display: { pt: "Provérbios", en: "Proverbs" } },
  { match: /\bisa[ií]as\b|\bisaiah\b/i, en: "Isaiah", display: { pt: "Isaías", en: "Isaiah" } },
  { match: /\bjeremias\b|\bjeremiah\b/i, en: "Jeremiah", display: { pt: "Jeremias", en: "Jeremiah" } },
  { match: /\bezequiel\b|\bezekiel\b/i, en: "Ezekiel", display: { pt: "Ezequiel", en: "Ezekiel" } },
  { match: /\bdaniel\b/i, en: "Daniel", display: { pt: "Daniel", en: "Daniel" } },
  { match: /\bmateus\b|\bmatthew\b/i, en: "Matthew", display: { pt: "Mateus", en: "Matthew", es: "Mateo", it: "Matteo" } },
  { match: /\bmarcos\b|\bmark\b/i, en: "Mark", display: { pt: "Marcos", en: "Mark", es: "Marcos", it: "Marco" } },
  { match: /\blucas\b|\bluke\b/i, en: "Luke", display: { pt: "Lucas", en: "Luke", es: "Lucas", it: "Luca" } },
  { match: /\bjo[aã]o\b|\bjohn\b/i, en: "John", display: { pt: "João", en: "John", es: "Juan", it: "Giovanni" } },
  { match: /\batos\b|\bacts\b/i, en: "Acts", display: { pt: "Atos", en: "Acts" } },
  { match: /\bromanos\b|\bromans\b/i, en: "Romans", display: { pt: "Romanos", en: "Romans" } },
  { match: /\b1\s*cor[ií]ntios\b|\b1\s*corinthians\b/i, en: "1 Corinthians", display: { pt: "1 Coríntios", en: "1 Corinthians" } },
  { match: /\b2\s*cor[ií]ntios\b|\b2\s*corinthians\b/i, en: "2 Corinthians", display: { pt: "2 Coríntios", en: "2 Corinthians" } },
  { match: /\bg[aá]latas\b|\bgalatians\b/i, en: "Galatians", display: { pt: "Gálatas", en: "Galatians" } },
  { match: /\bef[eé]sios\b|\bephesians\b/i, en: "Ephesians", display: { pt: "Efésios", en: "Ephesians" } },
  { match: /\bfilipenses\b|\bphilippians\b/i, en: "Philippians", display: { pt: "Filipenses", en: "Philippians" } },
  { match: /\bcolossenses\b|\bcolossians\b/i, en: "Colossians", display: { pt: "Colossenses", en: "Colossians" } },
  { match: /\b1\s*tessalonicenses\b|\b1\s*thessalonians\b/i, en: "1 Thessalonians", display: { pt: "1 Tessalonicenses", en: "1 Thessalonians" } },
  { match: /\b2\s*tessalonicenses\b|\b2\s*thessalonians\b/i, en: "2 Thessalonians", display: { pt: "2 Tessalonicenses", en: "2 Thessalonians" } },
  { match: /\b1\s*tim[oó]teo\b|\b1\s*timothy\b/i, en: "1 Timothy", display: { pt: "1 Timóteo", en: "1 Timothy" } },
  { match: /\b2\s*tim[oó]teo\b|\b2\s*timothy\b/i, en: "2 Timothy", display: { pt: "2 Timóteo", en: "2 Timothy" } },
  { match: /\btito\b|\btitus\b/i, en: "Titus", display: { pt: "Tito", en: "Titus" } },
  { match: /\bhebreus\b|\bhebrews\b/i, en: "Hebrews", display: { pt: "Hebreus", en: "Hebrews" } },
  { match: /\btiago\b|\bjames\b/i, en: "James", display: { pt: "Tiago", en: "James" } },
  { match: /\b1\s*pedro\b|\b1\s*peter\b/i, en: "1 Peter", display: { pt: "1 Pedro", en: "1 Peter" } },
  { match: /\b2\s*pedro\b|\b2\s*peter\b/i, en: "2 Peter", display: { pt: "2 Pedro", en: "2 Peter" } },
  { match: /\b1\s*jo[aã]o\b|\b1\s*john\b/i, en: "1 John", display: { pt: "1 João", en: "1 John" } },
  { match: /\b2\s*jo[aã]o\b|\b2\s*john\b/i, en: "2 John", display: { pt: "2 João", en: "2 John" } },
  { match: /\b3\s*jo[aã]o\b|\b3\s*john\b/i, en: "3 John", display: { pt: "3 João", en: "3 John" } },
  { match: /\bapocalipse\b|\brevelation\b/i, en: "Revelation", display: { pt: "Apocalipse", en: "Revelation" } },
];

const REF_RE =
  /\b((?:1|2|3)\s*)?([A-Za-zÀ-ú]{2,}(?:\s+[A-Za-zÀ-ú]+){0,2})\s+(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/gi;

export function detectBibleRefs(text: string): BibleHit[] {
  const hits: BibleHit[] = [];
  REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_RE.exec(text))) {
    const prefix = (match[1] ?? "").trim();
    const name = `${prefix ? `${prefix} ` : ""}${match[2]}`.trim();
    const chapter = Number(match[3]);
    const verse = Number(match[4]);
    const verseEnd = match[5] ? Number(match[5]) : undefined;
    const book = BOOK_MAP.find((b) => b.match.test(name));
    if (!book || !chapter || !verse) continue;
    const displayPt = book.display.pt ?? book.en;
    hits.push({
      ref: `${displayPt} ${chapter}:${verse}${verseEnd ? `-${verseEnd}` : ""}`,
      bookEn: book.en,
      chapter,
      verse,
      verseEnd,
    });
  }
  return hits;
}

const verseCache = new Map<string, string>();

export async function fetchCanonicalVerse(
  hit: BibleHit,
  lang: LanguageCode,
): Promise<string | null> {
  const cacheKey = `${hit.bookEn}|${hit.chapter}|${hit.verse}|${hit.verseEnd ?? ""}|${lang}`;
  const cached = verseCache.get(cacheKey);
  if (cached) return cached;

  try {
    const query = encodeURIComponent(
      `${hit.bookEn} ${hit.chapter}:${hit.verse}${hit.verseEnd ? `-${hit.verseEnd}` : ""}`,
    );
    const response = await fetch(`https://bible-api.com/${query}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { text?: string; reference?: string };
    let text = (data.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    if (lang !== "en") {
      // Keep English canonical as fallback body; polish book names in the chip only
      text = polishChurchTerms(text, lang);
    }

    const labeled = `${hit.ref} — ${text}`;
    verseCache.set(cacheKey, labeled);
    if (verseCache.size > 200) {
      const first = verseCache.keys().next().value;
      if (first) verseCache.delete(first);
    }
    return labeled;
  } catch {
    return null;
  }
}

/** True when the open phrase is mostly reading the verse (short + contains a ref). */
export function looksLikeVerseReading(text: string, hit: BibleHit) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const bookToken = hit.ref.split(" ")[0]?.toLowerCase() ?? "";
  const hasRef = Boolean(bookToken) && text.toLowerCase().includes(bookToken);
  // Reading aloud is brief; longer speech is commentary around the reference.
  return hasRef && words <= 16;
}
