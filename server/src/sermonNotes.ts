import { summarizeSermon } from "./translate.js";
import { captionText, type LanguageCode, type Space } from "./types.js";

const NOTES_MESSAGE: Record<LanguageCode, { notEnough: string; summaryFailed: string; missingSpace: string; failed: string }> = {
  pt: {
    notEnough: "Ainda não há texto suficiente para o resumo.",
    summaryFailed: "Não foi possível gerar o resumo agora. Você ainda pode copiar o texto completo abaixo.",
    missingSpace: "Este culto não existe ou já terminou.",
    failed: "Não foi possível montar o texto.",
  },
  en: {
    notEnough: "There is not enough text for a summary yet.",
    summaryFailed: "The summary could not be generated right now. You can still copy the full text below.",
    missingSpace: "This space does not exist or has already ended.",
    failed: "Could not build the text.",
  },
  es: {
    notEnough: "Todavía no hay texto suficiente para el resumen.",
    summaryFailed: "No se pudo generar el resumen ahora. Aún puedes copiar el texto completo de abajo.",
    missingSpace: "Este culto no existe o ya terminó.",
    failed: "No se pudo armar el texto.",
  },
  it: {
    notEnough: "Non c’è ancora abbastanza testo per il riassunto.",
    summaryFailed: "Non è stato possibile generare il riassunto adesso. Puoi comunque copiare il testo completo qui sotto.",
    missingSpace: "Questo culto non esiste o è già terminato.",
    failed: "Impossibile comporre il testo.",
  },
  fa: {
    notEnough: "هنوز متن کافی برای خلاصه نیست.",
    summaryFailed: "الان ساخت خلاصه ممکن نشد. هنوز می‌توانید متن کامل پایین را کپی کنید.",
    missingSpace: "این جلسه وجود ندارد یا به پایان رسیده است.",
    failed: "ساخت متن ممکن نشد.",
  },
  ur: {
    notEnough: "خلاصے کے لیے ابھی کافی متن نہیں۔",
    summaryFailed: "خلاصہ ابھی نہیں بن سکا۔ آپ نیچے مکمل متن کاپی کر سکتے ہیں۔",
    missingSpace: "یہ خدمت موجود نہیں یا ختم ہو چکی ہے۔",
    failed: "متن نہیں بن سکا۔",
  },
};

export function notesMessage(lang: LanguageCode, key: keyof (typeof NOTES_MESSAGE)["en"]) {
  return NOTES_MESSAGE[lang][key];
}

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
      error: notesMessage(lang, "notEnough"),
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
      notesMessage(lang, "summaryFailed"),
  };
}
