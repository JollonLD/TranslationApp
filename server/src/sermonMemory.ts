/**
 * Slow-path sermon card — theme, names, last verse, key terms.
 * Updated every ~25s; used only to revise frozen captions, never on the Riva hot path.
 */
import type { LanguageCode } from "./types.js";

export type SermonCard = {
  theme: string;
  names: string[];
  lastRef: string;
  terms: string[];
  updatedAt: number;
};

const cards = new Map<string, SermonCard>();
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function llmModel() {
  return (
    process.env.NVIDIA_LLM_MODEL?.trim() ||
    process.env.NVIDIA_MODEL?.trim() ||
    "stepfun-ai/step-5-preview"
  );
}

export function getSermonCard(code: string): SermonCard | null {
  return cards.get(code) ?? null;
}

export function clearSermonCard(code: string) {
  cards.delete(code);
}

export function formatCardForPrompt(card: SermonCard | null) {
  if (!card) return "";
  return [
    card.theme ? `Theme: ${card.theme}` : "",
    card.names.length ? `Names: ${card.names.join(", ")}` : "",
    card.lastRef ? `Last scripture: ${card.lastRef}` : "",
    card.terms.length ? `Terms: ${card.terms.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function refreshSermonCard(
  code: string,
  recentText: string,
  sourceLang: LanguageCode,
): Promise<SermonCard | null> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  const body = recentText.trim().slice(-4000);
  if (!key || key === "$NVIDIA_API_KEY" || body.split(/\s+/).length < 20) {
    return cards.get(code) ?? null;
  }

  try {
    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmModel(),
        messages: [
          {
            role: "system",
            content:
              "Extract a tiny JSON card from an evangelical sermon transcript. No markdown. Keys: theme (string), names (string[] max 6), lastRef (string), terms (string[] max 6).",
          },
          {
            role: "user",
            content: `Source language: ${sourceLang}\nTranscript:\n${body}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 400,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) return cards.get(code) ?? null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return cards.get(code) ?? null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<SermonCard>;
    const card: SermonCard = {
      theme: String(parsed.theme ?? "").slice(0, 160),
      names: Array.isArray(parsed.names)
        ? parsed.names.map(String).slice(0, 6)
        : [],
      lastRef: String(parsed.lastRef ?? "").slice(0, 80),
      terms: Array.isArray(parsed.terms)
        ? parsed.terms.map(String).slice(0, 6)
        : [],
      updatedAt: Date.now(),
    };
    cards.set(code, card);
    return card;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[sermon-memory] refresh skipped (${msg})`);
    return cards.get(code) ?? null;
  }
}
