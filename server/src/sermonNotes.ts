import { summarizeSermon } from "./translate.js";
import { captionText, type LanguageCode, type Space } from "./types.js";

export function buildFullTranscript(space: Space, lang: LanguageCode) {
  const lines = space.captions
    .filter((caption) => caption.isFinal)
    .map((caption) => captionText(caption, lang).trim())
    .filter(Boolean);
  return {
    lines,
    fullText: lines.join("\n\n"),
    originalText: space.captions
      .filter((caption) => caption.isFinal)
      .map((caption) => caption.original.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}

export async function buildSermonNotes(space: Space, lang: LanguageCode) {
  const transcript = buildFullTranscript(space, lang);
  if (!transcript.fullText.trim()) {
    return {
      ok: false as const,
      error: "Ainda não há texto suficiente para o resumo.",
      ...transcript,
      summary: "",
    };
  }

  const summary = await summarizeSermon({
    fullText: transcript.fullText,
    originalText: transcript.originalText,
    lang,
  });

  return {
    ok: true as const,
    ...transcript,
    summary:
      summary ||
      "Não foi possível gerar o resumo agora. Você ainda pode copiar o texto completo abaixo.",
  };
}
