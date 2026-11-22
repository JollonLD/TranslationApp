/**
 * Filters typical Whisper hallucinations (silence/music) before they become captions.
 * Conservative: only whole-sentence matches, never partial removal of real speech
 * (except collapsing degenerate repeats, which keeps one occurrence).
 */

function norm(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Matched against the normalized WHOLE sentence, so "obrigado, Senhor" and
// "thank you, Jesus" are not affected. Only the speaker's language is checked.
const PT_PATTERNS: RegExp[] = [
  /^(muito )?obrigad[oa]( a todos| pessoal)?( por assistir| por assistirem| por ter assistido| pela atencao| pela audiencia)$/,
  /^obrigad[oa] por (assistir|assistirem)( este| esse| o)?( video)?$/,
  /^legendas? (pela|da|por) comunidade amara org$/,
  /^legendas? pela comunidade$/,
  /^legendad[oa] por .+$/,
  /^traduzid[oa] por .+$/,
  /^inscreva se( no canal| no meu canal)?( e ative o sino)?$/,
  /^se inscreva( no canal)?$/,
  /^deixe o seu like.*$/,
  /^(tchau )+tchau$/,
  /^ate (a )?proxima( video)?$/,
  /^ate o proximo video$/,
];

const EN_PATTERNS: RegExp[] = [
  /^thanks? for watching( this video)?$/,
  /^thank you for watching( this video)?$/,
  /^thank you( very much| so much)?$/,
  /^subtitles? by .+$/,
  /^please subscribe( to (the|my) channel)?$/,
  /^subscribe to (the|my) channel$/,
  /^bye( bye)+$/,
];

const IT_PATTERNS: RegExp[] = [
  /^sottotitoli creati dalla comunita amara org$/,
  /^sottotitoli (e revisione )?a cura di .+$/,
  /^grazie (a tutti )?per la visione$/,
  /^iscriviti al canale$/,
  /^(ciao )+ciao$/,
];

const PATTERNS: Record<string, RegExp[]> = { pt: PT_PATTERNS, en: EN_PATTERNS, it: IT_PATTERNS };

/** Words a congregation really repeats; a run of them is worship, not a glitch. */
const LITURGICAL = new Set(["aleluia", "amem", "santo", "santa", "gloria", "hosana", "digno", "jesus", "senhor", "aleluya", "amen", "holy", "alleluia", "alleluja", "osanna"]);

/** Whisper loops run long; people repeat a word a few times. */
const LOOP_WORD_RUN = 8;
const LOOP_CHUNK_RUN = 6;

export function isHallucination(sentence: string, lang = "pt"): boolean {
  const raw = sentence.trim();
  if (!raw) return false;
  // "[Música]", "(aplausos)", "♪ ♪": annotations, never speech.
  if (/^[\[(][^\])]*[\])][.!…]*$/.test(raw)) return true;
  const n = norm(raw.replace(/[♪♫♬]/g, " "));
  if (!n) return true; // only punctuation, "…" or music notes
  if ((PATTERNS[lang] ?? []).some((re) => re.test(n))) return true;
  const words = n.split(" ");
  // One word looping many times, unless it is a word people sing over and over.
  if (words.length >= LOOP_WORD_RUN * 2 && new Set(words).size === 1 && !LITURGICAL.has(words[0])) return true;
  return false;
}

function keepThree(run: string, unit: string, sep: string) {
  return [unit, unit, unit].join(sep);
}

/**
 * Shortens Whisper loops (a word 8+ times, or a phrase 6+ times in a row) to
 * three occurrences. Shorter runs ("santo, santo, santo, santo") are speech and stay.
 */
export function stripRepeats(text: string): string {
  let out = text;
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\p{N}])([\p{L}\p{N}']+)((?:[\s,.;:!?…-]+)\1(?![\p{L}\p{N}'])){${LOOP_WORD_RUN - 1},}`, "giu"),
    (run: string, word: string, last: string) => {
      const sep = last.slice(0, last.length - word.length) || " ";
      return keepThree(run, word, sep);
    },
  );
  out = out.replace(
    new RegExp(String.raw`((?:[\p{L}\p{N}']+[\s,.;:!?…-]+){1,7}[\p{L}\p{N}']+)((?:[\s,.;:!?…-]+)\1(?![\p{L}\p{N}'])){${LOOP_CHUNK_RUN - 1},}`, "giu"),
    (run: string, chunk: string, last: string) => {
      const sep = last.slice(0, last.length - chunk.length) || " ";
      return keepThree(run, chunk, sep);
    },
  );
  return out === text ? text : out.replace(/\s{2,}/g, " ").trim();
}
