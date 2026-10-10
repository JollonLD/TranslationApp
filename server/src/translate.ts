/**
 * Free machine translation only (no LLM).
 * Order: Google Translate → DeepL (optional key) → Lingva → MyMemory.
 * Evangelical glossary (Bible books, verses, doctrine) keeps terms consistent.
 */
import {
  glossaryExact,
  polishChurchTerms,
  prepareChurchSource,
} from "./churchGlossary.js";
import type { LanguageCode } from "./types.js";

export type TranslateHealth = "ok" | "degraded" | "down";

const cache = new Map<string, string>();
const MYMEMORY_COOLDOWN_MS = 60 * 60_000;
let myMemoryPausedUntil = 0;
/** Prevents parallel workers from stampeding MyMemory after Google/Lingva miss. */
let myMemoryBusy = false;
let consecutiveFailures = 0;
let health: TranslateHealth = "ok";

const MYMEMORY_LOCALE: Record<LanguageCode, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
  it: "it-IT",
  fa: "fa-IR",
  ur: "ur-PK",
};

const LINGVA_HOSTS = [
  "https://lingva.ml",
  "https://lingva.thedaviddelta.com",
  "https://translate.plausibility.cloud",
  "https://lingva.pussthecat.org",
];

/** Proper nouns / shared church words — do not treat as "failed to translate". */
const OVERLAP_IGNORE = new Set([
  "deus",
  "god",
  "jesus",
  "cristo",
  "christ",
  "senhor",
  "lord",
  "amén",
  "amem",
  "amen",
  "aleluia",
  "hallelujah",
  "alleluia",
  "espirito",
  "espírito",
  "spirit",
  "biblia",
  "bíblia",
  "bible",
  "paulo",
  "pedro",
  "maria",
  "moises",
  "moisés",
  "abraao",
  "abraão",
  "israel",
  "jerusalem",
  "jerusalém",
]);

let googleNextAt = 0;

function cacheKey(text: string, source: LanguageCode, target: LanguageCode) {
  return `${source}|${target}|${text.trim().toLowerCase()}`;
}

/** Normalize ASR + church cues, then help MT treat long chunks as clauses. */
function prepareSource(text: string, source: LanguageCode) {
  let out = prepareChurchSource(text, source);
  if (out && !/[.?!…]$/.test(out) && out.split(" ").length >= 6) {
    out = `${out}.`;
  }
  return out;
}

function formatTranslation(text: string) {
  let out = text.trim().replace(/\s+/g, " ");
  // Drop duplicated spaces / odd quotes from free APIs
  out = out.replace(/^["'«]+|["'»]+$/g, "").trim();
  if (!out) return out;
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

function scoreCandidate(source: string, translated: string, sourceLang: LanguageCode, targetLang: LanguageCode) {
  if (!translated || looksBroken(source, translated, sourceLang, targetLang)) return -1;
  // Prefer natural length near source, and low leftover source-word overlap
  const overlap = sourceWordOverlap(source, translated);
  const lengthRatio = translated.length / Math.max(source.length, 1);
  const lengthScore = lengthRatio > 0.4 && lengthRatio < 2.2 ? 1 : 0.4;
  return (1 - overlap) * 2 + lengthScore;
}

function pauseMyMemory(reason: string) {
  const alreadyPaused = Date.now() < myMemoryPausedUntil;
  myMemoryPausedUntil = Date.now() + MYMEMORY_COOLDOWN_MS;
  if (health === "ok") health = "degraded";
  // One log per cooldown window — parallel jobs used to spam this line
  if (!alreadyPaused) {
    const mins = Math.round(MYMEMORY_COOLDOWN_MS / 60_000);
    console.warn(`[translate] MyMemory paused ${mins}m (${reason}) — using Google/Lingva only`);
  }
}

function markSuccess() {
  consecutiveFailures = 0;
  if (Date.now() >= myMemoryPausedUntil) health = "ok";
  else health = "degraded";
}

function markFailure() {
  consecutiveFailures += 1;
  health = consecutiveFailures >= 3 ? "down" : "degraded";
}

export function getTranslateHealth(): TranslateHealth {
  if (Date.now() < myMemoryPausedUntil && health === "ok") return "degraded";
  return health;
}

function sourceWordOverlap(source: string, translated: string) {
  const stop = new Set([
    "que",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "a",
    "o",
    "e",
    "em",
    "no",
    "na",
    "com",
    "para",
    "um",
    "uma",
    "os",
    "as",
    "the",
    "and",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
  ]);
  const src = source
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!?…]+$/g, ""))
    .filter((w) => w.length > 3 && !stop.has(w) && !OVERLAP_IGNORE.has(w));
  if (!src.length) return 0;
  const translatedSet = new Set(
    translated
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[.,;:!?…]+$/g, "")),
  );
  let hit = 0;
  for (const word of src) {
    if (translatedSet.has(word)) hit += 1;
  }
  return hit / src.length;
}

function looksBroken(source: string, translated: string, sourceLang: LanguageCode, targetLang: LanguageCode) {
  if (!translated) return true;
  if (translated.length < 2) return true;
  if (translated.toLowerCase() === source.toLowerCase() && sourceLang !== targetLang) return true;
  // Short church phrases often keep shared names — only reject near-total leftover source
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  const limit = words <= 4 ? 0.9 : 0.8;
  if (sourceLang !== targetLang && sourceWordOverlap(source, translated) > limit) return true;
  return false;
}

async function paceGoogle() {
  const wait = googleNextAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  // ~12 req/s max — sustains a 1h service without hammering Google
  googleNextAt = Date.now() + 80;
}

async function translateDeepL(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  const key = process.env.DEEPL_API_KEY?.trim();
  if (!key) return null;

  const deeplSource: Record<LanguageCode, string | null> = {
    pt: "PT",
    en: "EN",
    es: "ES",
    it: "IT",
    fa: null,
    ur: null,
  };
  const deeplTarget: Record<LanguageCode, string | null> = {
    pt: "PT-BR",
    en: "EN-US",
    es: "ES",
    it: "IT",
    fa: null,
    ur: null,
  };
  const sl = deeplSource[source];
  const tl = deeplTarget[target];
  if (!sl || !tl) return null;

  const endpoint = key.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const body = new URLSearchParams();
  body.set("text", text.slice(0, 4500));
  body.set("source_lang", sl);
  body.set("target_lang", tl);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    translations?: Array<{ text?: string }>;
  };
  return data.translations?.[0]?.text?.trim() || null;
}

function parseGooglePayload(data: unknown): string | null {
  if (!data) return null;

  if (typeof data === "object" && !Array.isArray(data)) {
    const sentences = (data as { sentences?: Array<{ trans?: string }> }).sentences;
    if (Array.isArray(sentences)) {
      const joined = sentences.map((s) => s.trans ?? "").join("").trim();
      if (joined) return joined;
    }
  }

  if (!Array.isArray(data)) return null;
  const chunks = data[0];
  if (!Array.isArray(chunks)) return null;
  const translated = chunks
    .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ""))
    .join("")
    .trim();
  return translated || null;
}

async function translateGoogleOnce(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
  endpoint: "gtx" | "dict",
): Promise<string | null> {
  await paceGoogle();

  if (endpoint === "dict") {
    const url = new URL("https://clients5.google.com/translate_a/t");
    url.searchParams.set("client", "dict-chrome-ex");
    url.searchParams.set("sl", source);
    url.searchParams.set("tl", target);
    url.searchParams.set("q", text.slice(0, 4500));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    // dict-chrome-ex often returns [["translated", "source"], ...] or [[["translated","source"]]]
    if (Array.isArray(data)) {
      const first = data[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (Array.isArray(first)) {
        const inner = first[0];
        if (typeof inner === "string" && inner.trim()) return inner.trim();
        if (Array.isArray(inner) && typeof inner[0] === "string") return inner[0].trim();
      }
    }
    return parseGooglePayload(data);
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("dj", "1");
  url.searchParams.set("q", text.slice(0, 4500));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) return null;
  return parseGooglePayload(await response.json());
}

async function translateGoogle(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  // Primary engine for a full service (~1h): retry + alternate endpoint
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const hit = await translateGoogleOnce(text, source, target, "gtx");
      if (hit) return hit;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  try {
    return await translateGoogleOnce(text, source, target, "dict");
  } catch {
    return null;
  }
}

async function translateLingva(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  const encoded = encodeURIComponent(text.slice(0, 1200));
  for (const host of LINGVA_HOSTS) {
    try {
      const response = await fetch(`${host}/api/v1/${source}/${target}/${encoded}`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { translation?: string };
      const translated = data.translation?.trim();
      if (translated) return translated;
    } catch {
      /* try next host */
    }
  }
  return null;
}

async function translateMyMemory(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  if (Date.now() < myMemoryPausedUntil) return null;
  // Only one MyMemory request at a time across the whole process
  if (myMemoryBusy) return null;
  myMemoryBusy = true;

  try {
    const pairs = [
      `${MYMEMORY_LOCALE[source]}|${MYMEMORY_LOCALE[target]}`,
      `${source}|${target}`,
    ];

    for (const langpair of pairs) {
      if (Date.now() < myMemoryPausedUntil) return null;

      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", text.slice(0, 500));
      url.searchParams.set("langpair", langpair);
      url.searchParams.set("de", process.env.MYMEMORY_EMAIL ?? "palavra.igreja@gmail.com");

      const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (response.status === 429) {
        pauseMyMemory("rate limited");
        return null;
      }
      if (!response.ok) continue;

      const data = (await response.json()) as {
        responseData?: { translatedText?: string };
        responseStatus?: number;
        quotaFinished?: boolean;
      };

      const translated = data.responseData?.translatedText?.trim();
      if (!translated || /MYMEMORY WARNING/i.test(translated)) {
        pauseMyMemory("warning or empty response");
        return null;
      }
      if (data.quotaFinished || Number(data.responseStatus) === 429) {
        pauseMyMemory("quota finished");
        return null;
      }
      if (Number(data.responseStatus) !== 200) continue;

      const cleaned = translated.trim();
      if (cleaned) return cleaned;
    }

    return null;
  } finally {
    myMemoryBusy = false;
  }
}

async function translateWithFallback(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  // 1) Google first (reliable for a full ~1h service) — do not wait on weaker engines
  try {
    const google = await translateGoogle(text, source, target);
    if (google && !looksBroken(text, google, source, target)) return google;
    if (google) return google; // prefer imperfect MT over leaving Portuguese
  } catch {
    /* continue */
  }

  // 2) Race Lingva + optional DeepL
  const raced = await Promise.allSettled([
    translateLingva(text, source, target),
    translateDeepL(text, source, target),
  ]);

  let best: string | null = null;
  let bestScore = -1;
  let any: string | null = null;
  for (const result of raced) {
    if (result.status !== "fulfilled" || !result.value) continue;
    any = any ?? result.value;
    const score = scoreCandidate(text, result.value, source, target);
    if (score > bestScore) {
      bestScore = score;
      best = result.value;
    }
  }
  if (best) return best;
  if (any) return any;

  // 3) MyMemory last — skipped automatically for 1h after rate limit
  if (Date.now() < myMemoryPausedUntil) return null;
  try {
    const fallback = await translateMyMemory(text, source, target);
    if (fallback) return fallback;
  } catch {
    /* ignore */
  }
  return null;
}

export async function translateText(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (source === target) return trimmed;

  const prepared = prepareSource(trimmed, source);
  const key = cacheKey(prepared, source, target);
  const cached = cache.get(key);
  if (cached) return cached;

  const exact = glossaryExact(prepared, target);
  if (exact) {
    cache.set(key, exact);
    return exact;
  }

  try {
    const raw = await translateWithFallback(prepared, source, target);
    if (!raw) {
      markFailure();
      return trimmed;
    }

    const translated = formatTranslation(polishChurchTerms(raw, target));
    markSuccess();
    cache.set(key, translated);
    // Also cache the raw ASR form so repeats hit immediately
    cache.set(cacheKey(trimmed, source, target), translated);
    return translated;
  } catch {
    markFailure();
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

type QueueJob = {
  run: () => Promise<void>;
};

const queues = new Map<string, { busy: boolean; jobs: QueueJob[] }>();

function getQueue(code: string) {
  let queue = queues.get(code);
  if (!queue) {
    queue = { busy: false, jobs: [] };
    queues.set(code, queue);
  }
  return queue;
}

export function clearTranslateQueue(code: string) {
  queues.delete(code);
}

/** One committed phrase at a time per space, in order. */
export function enqueueTranslate(
  code: string,
  run: () => Promise<void>,
): Promise<void> {
  const queue = getQueue(code);
  return new Promise((resolve, reject) => {
    queue.jobs.push({
      run: async () => {
        try {
          await run();
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    });
    void pumpQueue(code);
  });
}

async function pumpQueue(code: string) {
  const queue = getQueue(code);
  if (queue.busy) return;
  const next = queue.jobs.shift();
  if (!next) return;
  queue.busy = true;
  try {
    await next.run();
  } finally {
    queue.busy = false;
    if (queue.jobs.length) void pumpQueue(code);
  }
}
