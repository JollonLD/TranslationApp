/**
 * Fast path: NVIDIA Riva Translate 4B via build.nvidia.com.
 * Prompt must be language-pair tag in system + source text in user.
 */
import { polishChurchTerms } from "./churchGlossary.js";
import type { LanguageCode } from "./types.js";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MT = "nvidia/riva-translate-4b-instruct-v2";

let rivaPausedUntil = 0;
let rivaDead = false;

/** Direct Riva pair tags (system message). */
const DIRECT: Partial<Record<`${LanguageCode}-${LanguageCode}`, string>> = {
  "pt-en": "pt-br-en",
  "en-pt": "en-pt-br",
  "en-es": "en-es-us",
  "es-en": "es-us-en",
  "en-it": "en-it",
  "it-en": "it-en",
  "pt-pt": "",
  "en-en": "",
  "es-es": "",
  "it-it": "",
};

function mtModel() {
  return process.env.NVIDIA_MT_MODEL?.trim() || DEFAULT_MT;
}

function apiKey() {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key || key === "$NVIDIA_API_KEY") return null;
  return key;
}

export function rivaSupportsDirect(source: LanguageCode, target: LanguageCode) {
  if (source === target) return true;
  return Boolean(DIRECT[`${source}-${target}` as `${LanguageCode}-${LanguageCode}`]);
}

export function rivaCanPivot(source: LanguageCode, target: LanguageCode) {
  if (rivaSupportsDirect(source, target)) return true;
  // pt → es/it via English
  if (source === "pt" && (target === "es" || target === "it")) return true;
  if ((source === "es" || source === "it") && target === "pt") return true;
  return false;
}

type RivaResult = { text: string | null; status: number };

async function rivaOnce(
  pair: string,
  text: string,
  signal?: AbortSignal,
): Promise<RivaResult> {
  const key = apiKey();
  if (!key || rivaDead || Date.now() < rivaPausedUntil) {
    return { text: null, status: 0 };
  }

  const response = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: mtModel(),
      messages: [
        { role: "system", content: pair },
        { role: "user", content: text.slice(0, 3500) },
      ],
      temperature: 0.1,
      top_p: 0.9,
      max_tokens: 512,
      stream: false,
    }),
    signal: signal ?? AbortSignal.timeout(12_000),
  });

  if (response.status === 410 || response.status === 404) {
    rivaDead = true;
    console.warn(`[riva] model unavailable HTTP ${response.status}`);
    return { text: null, status: response.status };
  }
  if (response.status === 401 || response.status === 403) {
    rivaPausedUntil = Date.now() + 30 * 60_000;
    console.warn(`[riva] auth ${response.status}`);
    return { text: null, status: response.status };
  }
  if (response.status === 429) {
    rivaPausedUntil = Date.now() + 20_000;
    console.warn("[riva] rate limited — using fallback for 20s");
    return { text: null, status: response.status };
  }
  if (!response.ok) {
    return { text: null, status: response.status };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const out = (data.choices?.[0]?.message?.content ?? "").trim();
  return { text: out || null, status: response.status };
}

async function translateDirect(
  source: LanguageCode,
  target: LanguageCode,
  text: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (source === target) return text;
  const pair = DIRECT[`${source}-${target}` as `${LanguageCode}-${LanguageCode}`];
  if (!pair) return null;
  const result = await rivaOnce(pair, text, signal);
  return result.text;
}

/**
 * Fast Riva translation. Pivots through English for pt↔es / pt↔it.
 * Applies church glossary AFTER the model (never before).
 */
export async function translateRiva(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
  signal?: AbortSignal,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (source === target) return trimmed;
  if (!apiKey() || rivaDead || Date.now() < rivaPausedUntil) return null;

  try {
    let out: string | null = null;

    if (rivaSupportsDirect(source, target)) {
      out = await translateDirect(source, target, trimmed, signal);
    } else if (source === "pt" && (target === "es" || target === "it")) {
      const en = await translateDirect("pt", "en", trimmed, signal);
      if (!en) return null;
      out = await translateDirect("en", target, en, signal);
    } else if ((source === "es" || source === "it") && target === "pt") {
      const en = await translateDirect(source, "en", trimmed, signal);
      if (!en) return null;
      out = await translateDirect("en", "pt", en, signal);
    } else {
      return null;
    }

    if (!out) return null;
    return polishChurchTerms(out, target);
  } catch (error) {
    if (signal?.aborted) return null;
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[riva] skipped (${msg})`);
    return null;
  }
}

export function getRivaHealth(): "ok" | "degraded" | "down" {
  if (rivaDead) return "down";
  if (Date.now() < rivaPausedUntil) return "degraded";
  return apiKey() ? "ok" : "degraded";
}
