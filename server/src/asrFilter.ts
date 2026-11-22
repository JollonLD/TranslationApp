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
// "thank you, Jesus" are not affected.
const FULL_PATTERNS: RegExp[] = [
  // pt
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
  /^tchau$/,
  /^ate (a )?proxima( video)?$/,
  /^ate o proximo video$/,
  /^musica( de fundo)?$/,
  /^aplausos$/,
  /^risos$/,
  /^silencio$/,
  // en
  /^thanks? for watching( this video)?$/,
  /^thank you for watching( this video)?$/,
  /^thank you( very much| so much)?$/,
  /^subtitles? by .+$/,
  /^please subscribe( to (the|my) channel)?$/,
  /^subscribe to (the|my) channel$/,
  /^bye( bye)*$/,
  /^music$/,
  /^applause$/,
  /^silence$/,
];

export function isHallucination(sentence: string, _lang = "pt"): boolean {
  const raw = sentence.trim();
  if (!raw) return false;
  const n = norm(raw.replace(/[♪♫♬]/g, " "));
  if (!n) return true; // only punctuation, "…" or music notes
  if (FULL_PATTERNS.some((re) => re.test(n))) return true;
  const words = n.split(" ");
  if (words.length >= 4 && new Set(words).size === 1) return true;
  const collapsed = stripRepeats(raw);
  if (collapsed !== raw && isHallucination(collapsed, _lang)) return true;
  return false;
}

/** Collapses word runs / phrase loops repeated >=4 times into a single occurrence. */
export function stripRepeats(text: string): string {
  let out = text;
  // Same word 4+ times in a row (punctuation between allowed).
  out = out.replace(
    /(?<![\p{L}\p{N}])([\p{L}\p{N}']+)(?:[\s,.;:!?…-]+\1(?![\p{L}\p{N}'])){3,}/giu,
    "$1",
  );
  // Multi-word chunk (2-8 words) repeated 4+ times.
  out = out.replace(
    /((?:[\p{L}\p{N}']+[\s,.;:!?…-]+){1,7}[\p{L}\p{N}']+)(?:[\s,.;:!?…-]+\1(?![\p{L}\p{N}'])){3,}/giu,
    "$1",
  );
  return out === text ? text : out.replace(/\s{2,}/g, " ").trim();
}
