/**
 * Fallback MT + slow-path LLM (summary / caption revision).
 * Fast live path uses rivaTranslate.ts (Riva 4B). Do not block captions on step-5.
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

/** Capitalize and close a committed caption so it reads as a sentence before the model edits it. */
export function finishSentence(text: string) {
  let out = text.trim().replace(/\s+/g, " ");
  if (!out) return out;
  out = out.charAt(0).toLocaleUpperCase() + out.slice(1);
  if (!/[.?!…]["'»”)]*$/.test(out)) out = `${out}.`;
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

const LANG_NAME: Record<LanguageCode, string> = {
  pt: "Portuguese (Brazil)",
  en: "English",
  es: "Spanish",
  it: "Italian",
  fa: "Persian (Farsi)",
  ur: "Urdu",
};

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
/**
 * Default model that still serves on build.nvidia.com free endpoints (2026).
 * Older ids like meta/llama-3.1-8b-instruct return HTTP 410 (EOL).
 * Override with NVIDIA_MODEL.
 */
const NVIDIA_DEFAULT_MODEL = "stepfun-ai/step-5-preview";
let nvidiaPausedUntil = 0;
/** Serialize slow LLM jobs (summary / revision) — never on the live caption path. */
let nvidiaTail: Promise<unknown> = Promise.resolve();
/** Models that returned 404/410 — never retry until process restart. */
const nvidiaDeadModels = new Set<string>();

function enqueueNvidia<T>(fn: () => Promise<T>): Promise<T> {
  const run = nvidiaTail.then(fn, fn);
  nvidiaTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function pauseNvidia(reason: string, ms = 5 * 60_000) {
  const already = Date.now() < nvidiaPausedUntil;
  nvidiaPausedUntil = Date.now() + ms;
  if (health === "ok") health = "degraded";
  if (!already) {
    console.warn(
      `[translate] NVIDIA LLM paused ${Math.round(ms / 60_000)}m (${reason})`,
    );
  }
}

function nvidiaModel(): string | null {
  const preferred =
    process.env.NVIDIA_LLM_MODEL?.trim() ||
    process.env.NVIDIA_MODEL?.trim() ||
    NVIDIA_DEFAULT_MODEL;
  if (nvidiaDeadModels.has(preferred)) return null;
  return preferred;
}

function extractNvidiaText(message: {
  content?: string | null;
  reasoning_content?: string | null;
}): string {
  let out = (message.content ?? "").trim();
  if (out) {
    return out
      .replace(/^["'«]+|["'»]+$/g, "")
      .replace(/^(translation|tradu[cç][aã]o)\s*:\s*/i, "")
      .trim();
  }
  // Reasoning models sometimes only fill reasoning_content when truncated
  const reasoning = (message.reasoning_content ?? "").trim();
  if (!reasoning) return "";
  const finalMark = reasoning.match(/(?:FINAL|Translation)\s*:\s*(.+)$/im);
  if (finalMark?.[1]) return finalMark[1].trim().replace(/^["']|["']$/g, "");
  const quoted = [...reasoning.matchAll(/"([^"]{8,200})"/g)].map((m) => m[1]);
  if (quoted.length) return quoted.at(-1)!.trim();
  return "";
}

type NvidiaPolishInput = {
  text: string;
  source: LanguageCode;
  target: LanguageCode;
  context?: string;
  draft?: string;
  priorTranslation?: string;
};

async function translateNvidiaOnce(
  key: string,
  model: string,
  input: NvidiaPolishInput,
): Promise<{ text: string | null; status: number; gone: boolean }> {
  const { text, source, target, context = "", draft = "", priorTranslation = "" } = input;

  const userParts = [
    context
      ? `Earlier speech in ${LANG_NAME[source]} (context only — do not retranslate it):\n${context.slice(-900)}\n`
      : "",
    priorTranslation
      ? `What the listener already read in ${LANG_NAME[target]} (keep continuity):\n${priorTranslation.slice(-500)}\n`
      : "",
    `New speech in ${LANG_NAME[source]}:\n${text.slice(0, 1200)}\n`,
    draft
      ? `Fast draft translation (Google) — fix grammar, meaning, and flow; keep the same ideas:\n${draft.slice(0, 1200)}\n`
      : "",
    `Write the final ${LANG_NAME[target]} caption for ONLY the new speech. One natural line for church listeners. No quotes or labels.`,
  ];

  const response = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a live church interpreter. Google gives a quick draft; you correct it using sermon context so pronouns and ideas make sense. Output ONLY the improved translation of the new part.",
        },
        {
          role: "user",
          content: userParts.filter(Boolean).join("\n"),
        },
      ],
      max_tokens: 768,
      temperature: 0.25,
      top_p: 0.9,
      stream: false,
    }),
    // Quality over speed — user accepts NVIDIA latency for better captions
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status === 410 || response.status === 404) {
    return { text: null, status: response.status, gone: true };
  }
  if (!response.ok) {
    return { text: null, status: response.status, gone: false };
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null; reasoning_content?: string | null };
    }>;
  };
  const out = extractNvidiaText(data.choices?.[0]?.message ?? {});
  return { text: out || null, status: response.status, gone: false };
}

/**
 * NVIDIA polishes Google's draft with rolling sermon context.
 * Slow is OK — we wait before emitting to listeners.
 */
async function polishWithNvidia(input: NvidiaPolishInput): Promise<string | null> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key || key === "$NVIDIA_API_KEY") return null;
  if (Date.now() < nvidiaPausedUntil) return null;
  const model = nvidiaModel();
  if (!model) return null;

  return enqueueNvidia(async () => {
    if (Date.now() < nvidiaPausedUntil) return null;
    try {
      const result = await translateNvidiaOnce(key, model, input);

      if (result.status === 401 || result.status === 403) {
        pauseNvidia(`auth ${result.status}`);
        return null;
      }
      if (result.status === 429) {
        pauseNvidia("rate limited", 10 * 60_000);
        return null;
      }
      if (result.gone) {
        nvidiaDeadModels.add(model);
        pauseNvidia(`model unavailable ${result.status}`, 30 * 60_000);
        return null;
      }
      if (result.status >= 400) {
        console.warn(`[translate] NVIDIA HTTP ${result.status} — keeping Google draft`);
        return null;
      }
      return result.text;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Keep Google draft for this line — do not pause the whole service
      console.warn(`[translate] NVIDIA polish skipped (${msg}) — keeping Google draft`);
      return null;
    }
  });
}

/** Last polished line per session+language — helps NVIDIA keep continuity. */
const priorBySession = new Map<string, string>();

function priorKey(sessionKey: string, target: LanguageCode) {
  return `${sessionKey}|${target}`;
}

export function clearTranslateSession(sessionKey: string) {
  for (const key of [...priorBySession.keys()]) {
    if (key.startsWith(`${sessionKey}|`)) priorBySession.delete(key);
  }
}

export type SummarizeSermonInput = {
  fullText: string;
  originalText?: string;
  lang: LanguageCode;
};

/**
 * Short evangelical sermon summary in the listener's language (NVIDIA when configured).
 */
export async function summarizeSermon(input: SummarizeSermonInput): Promise<string> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  const model = nvidiaModel();
  const lang = LANG_NAME[input.lang];
  const body = input.fullText.trim().slice(0, 14_000);
  if (!body) return "";

  if (!key || key === "$NVIDIA_API_KEY" || !model || Date.now() < nvidiaPausedUntil) {
    return fallbackSermonSummary(body, input.lang);
  }

  const polished = await enqueueNvidia(async () => {
    if (Date.now() < nvidiaPausedUntil) return null;
    try {
      const response = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You summarize evangelical church sermons for listeners who followed live captions. Write clear, faithful points. No fluff, no invented verses.",
            },
            {
              role: "user",
              content: [
                `Write a short summary of this ministry/sermon in ${lang}.`,
                "Include: main theme, 3–6 key points, any Bible references mentioned, and a short closing takeaway.",
                "Use plain paragraphs or short bullets. Output ONLY the summary.",
                "",
                "Translated captions:",
                body,
                input.originalText?.trim()
                  ? `\nOriginal speech (reference):\n${input.originalText.trim().slice(0, 6000)}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          max_tokens: 1200,
          temperature: 0.3,
          top_p: 0.9,
          stream: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (response.status === 410 || response.status === 404) {
        nvidiaDeadModels.add(model);
        pauseNvidia(`model unavailable ${response.status}`, 30 * 60_000);
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        pauseNvidia(`auth ${response.status}`);
        return null;
      }
      if (response.status === 429) {
        pauseNvidia("rate limited", 10 * 60_000);
        return null;
      }
      if (!response.ok) {
        console.warn(`[translate] NVIDIA summary HTTP ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null; reasoning_content?: string | null };
        }>;
      };
      return extractNvidiaText(data.choices?.[0]?.message ?? {}) || null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[translate] NVIDIA summary skipped (${msg})`);
      return null;
    }
  });

  return polished?.trim() || fallbackSermonSummary(body, input.lang);
}

function fallbackSermonSummary(fullText: string, lang: LanguageCode) {
  const paragraphs = fullText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/).length >= 8);
  const picks = paragraphs.filter((_, i) => i % Math.max(1, Math.floor(paragraphs.length / 5)) === 0).slice(0, 5);
  if (!picks.length) {
    const words = fullText.split(/\s+/).filter(Boolean).slice(0, 80).join(" ");
    return words ? `${words}…` : "";
  }
  const intro: Record<LanguageCode, string> = {
    pt: "Resumo automático (sem modelo):",
    en: "Automatic summary (no model):",
    es: "Resumen automático (sin modelo):",
    it: "Riassunto automatico (senza modello):",
    fa: "خلاصه خودکار (بدون مدل):",
    ur: "خودکار خلاصہ (بغیر ماڈل):",
  };
  return `${intro[lang]}\n\n${picks.map((p) => `• ${p}`).join("\n\n")}`;
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

function pickUsable(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
  candidate: string | null,
): string | null {
  if (!candidate) return null;
  if (!looksBroken(text, candidate, source, target)) return candidate;
  return candidate; // still prefer imperfect MT over silence
}

/**
 * Fast fallback MT (Google first). Does not wait for LLM polish.
 */
async function translateWithFallback(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
  options: TranslateOptions = {},
): Promise<string | null> {
  const sessionKey = options.sessionKey?.trim() ?? "";

  let draft =
    pickUsable(text, source, target, await translateGoogle(text, source, target).catch(() => null)) ??
    null;

  if (!draft) {
    const raced = await Promise.allSettled([
      translateLingva(text, source, target),
      translateDeepL(text, source, target),
    ]);
    for (const result of raced) {
      if (result.status === "fulfilled" && result.value) {
        draft = pickUsable(text, source, target, result.value);
        if (draft) break;
      }
    }
  }

  if (!draft && Date.now() >= myMemoryPausedUntil) {
    draft = pickUsable(
      text,
      source,
      target,
      await translateMyMemory(text, source, target).catch(() => null),
    );
  }

  if (sessionKey && draft) {
    priorBySession.set(priorKey(sessionKey, target), draft);
  }
  return draft;
}

/** Public Google draft — used for fa/ur on the live path. */
export async function translateGoogleDraft(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
): Promise<string | null> {
  const prepared = prepareSource(text, source);
  const raw = await translateGoogle(prepared, source, target).catch(() => null);
  if (!raw) return null;
  return formatTranslation(polishChurchTerms(raw, target));
}

export type ReviseCaptionInput = {
  original: string;
  draft: string;
  source: LanguageCode;
  target: LanguageCode;
  sermonCard?: string;
  priorTranslation?: string;
};

function contentWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[.,;:!?…"'“”«»()]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function keepsMeaning(before: string, after: string) {
  const sourceWords = contentWords(before);
  if (!after.trim()) return false;
  if (sourceWords.length < 3) return after.length < Math.max(before.length * 3, 80);
  const translated = new Set(contentWords(after));
  const kept = sourceWords.filter((word) => translated.has(word)).length;
  return kept / sourceWords.length >= 0.55;
}

function parseLangLines(raw: string, allowed: LanguageCode[]) {
  const text = raw.replace(/```[a-z]*|```/gi, " ").trim();
  const found: Partial<Record<LanguageCode, string>> = {};
  for (const line of text.split(/\n+/)) {
    const match = line.trim().match(/^(pt|en|es|it|fa|ur)\s*[:：-]\s*(.+)$/i);
    if (!match) continue;
    const lang = match[1].toLowerCase() as LanguageCode;
    if (!allowed.includes(lang)) continue;
    found[lang] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return found;
}

/**
 * Turn one frozen caption into complete sentences: punctuation and capitalization.
 * Rejects a rewrite that drops the speaker's words.
 */
export async function shapeSentencesWithLlm(input: {
  source: LanguageCode;
  drafts: Partial<Record<LanguageCode, string>>;
}): Promise<Partial<Record<LanguageCode, string>> | null> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  const model = nvidiaModel();
  if (!key || key === "$NVIDIA_API_KEY" || !model || Date.now() < nvidiaPausedUntil) {
    return null;
  }

  const langs = (Object.keys(input.drafts) as LanguageCode[]).filter((lang) => input.drafts[lang]);
  if (!langs.length) return null;

  const body = langs
    .map((lang) => `${lang}: ${input.drafts[lang]}`)
    .join("\n");

  return enqueueNvidia(async () => {
    if (Date.now() < nvidiaPausedUntil) return null;
    try {
      const response = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You punctuate live sermon captions. Add capitalization, commas, and final punctuation so each line is one or two complete sentences. Do not add facts, do not summarize, do not omit ideas, do not translate into a different language than the line you were given. Output one line per language, exactly as `code: sentence`. No markdown.",
            },
            { role: "user", content: body },
          ],
          max_tokens: 500,
          temperature: 0.2,
          stream: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (response.status === 410 || response.status === 404) {
        nvidiaDeadModels.add(model);
        pauseNvidia(`model unavailable ${response.status}`, 30 * 60_000);
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        pauseNvidia(`auth ${response.status}`);
        return null;
      }
      if (response.status === 429) {
        pauseNvidia("rate limited", 10 * 60_000);
        return null;
      }
      if (!response.ok) return null;

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null; reasoning_content?: string | null };
        }>;
      };
      const message = data.choices?.[0]?.message ?? {};
      const raw = `${message.content ?? ""}\n${message.reasoning_content ?? ""}`;
      const parsed = parseLangLines(raw, langs);
      const sourceDraft = input.drafts[input.source] ?? "";
      const sourceOut = parsed[input.source];
      if (!sourceOut || !keepsMeaning(sourceDraft, sourceOut)) return null;

      const accepted: Partial<Record<LanguageCode, string>> = {
        [input.source]: finishSentence(sourceOut),
      };
      for (const lang of langs) {
        if (lang === input.source) continue;
        const draft = input.drafts[lang] ?? "";
        const next = parsed[lang];
        if (next && keepsMeaning(draft, next)) accepted[lang] = finishSentence(next);
      }
      return accepted;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[translate] sentence shape skipped (${msg})`);
      return null;
    }
  });
}

/** Slow-path: revise one frozen caption with sermon memory (same id on client). */
export async function reviseCaptionWithLlm(
  input: ReviseCaptionInput,
): Promise<string | null> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  const model = nvidiaModel();
  if (!key || key === "$NVIDIA_API_KEY" || !model || Date.now() < nvidiaPausedUntil) {
    return null;
  }

  return enqueueNvidia(async () => {
    if (Date.now() < nvidiaPausedUntil) return null;
    try {
      const response = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You revise one live church caption. Keep meaning faithful. Fix pronouns using sermon context. Output ONLY the revised caption.",
            },
            {
              role: "user",
              content: [
                input.sermonCard ? `Sermon card:\n${input.sermonCard}\n` : "",
                input.priorTranslation
                  ? `Previous caption in ${LANG_NAME[input.target]}:\n${input.priorTranslation.slice(-400)}\n`
                  : "",
                `Source (${LANG_NAME[input.source]}):\n${input.original.slice(0, 800)}\n`,
                `Draft (${LANG_NAME[input.target]}):\n${input.draft.slice(0, 800)}\n`,
                `Revised ${LANG_NAME[input.target]} caption:`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          max_tokens: 400,
          temperature: 0.25,
          stream: false,
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (response.status === 410 || response.status === 404) {
        nvidiaDeadModels.add(model);
        pauseNvidia(`model unavailable ${response.status}`, 30 * 60_000);
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        pauseNvidia(`auth ${response.status}`);
        return null;
      }
      if (response.status === 429) {
        pauseNvidia("rate limited", 10 * 60_000);
        return null;
      }
      if (!response.ok) return null;

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null; reasoning_content?: string | null };
        }>;
      };
      const out = extractNvidiaText(data.choices?.[0]?.message ?? {});
      return out ? formatTranslation(polishChurchTerms(out, input.target)) : null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[translate] revise skipped (${msg})`);
      return null;
    }
  });
}

export type TranslateOptions = {
  /** Prior source speech for coherence (not shown again on captions). */
  context?: string;
  /** Space/session id so NVIDIA remembers the last line per language. */
  sessionKey?: string;
};

export async function translateText(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
  options: TranslateOptions = {},
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (source === target) return trimmed;

  const prepared = prepareSource(trimmed, source);
  const context = (options.context ?? "").trim();
  const key = cacheKey(`${options.sessionKey ?? ""}|${context}||${prepared}`, source, target);
  const cached = cache.get(key);
  if (cached) return cached;

  const exact = glossaryExact(prepared, target);
  if (exact) {
    cache.set(key, exact);
    return exact;
  }

  try {
    const raw = await translateWithFallback(prepared, source, target, options);
    if (!raw) {
      markFailure();
      return trimmed;
    }

    const translated = formatTranslation(polishChurchTerms(raw, target));
    markSuccess();
    cache.set(key, translated);
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
  options: TranslateOptions = {},
): Promise<Partial<Record<LanguageCode, string>>> {
  const translations: Partial<Record<LanguageCode, string>> = {
    [source]: text,
  };
  const unique = [...new Set(targets)].filter((lang) => lang !== source);
  await Promise.all(
    unique.map(async (lang) => {
      translations[lang] = await translateText(text, source, lang, options);
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
