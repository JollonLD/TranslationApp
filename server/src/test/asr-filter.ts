import { isHallucination, stripRepeats } from "../asrFilter.js";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

const bad = [
  "Obrigado por assistir!",
  "Obrigada por assistir.",
  "Legendas pela comunidade Amara.org",
  "Inscreva-se no canal",
  "Legendado por Fulano de Tal",
  "Tchau, tchau!",
  "...",
  "…",
  "[Música]",
  "Música",
  "♪",
  "♪ ♪",
  "Thanks for watching!",
  "Subtitles by the Amara.org community",
  "amém amém amém amém amém",
  "Sim, sim, sim, sim.",
];
for (const s of bad) check(`hallucination: ${s}`, isHallucination(s, "pt"));

const good = [
  "Obrigado, Senhor",
  "Obrigado por assistir a esta pregação hoje na igreja, irmãos",
  "Amém, amém, amém",
  "Jesus Cristo é o Senhor",
  "Música é uma forma de adoração",
  "Thank you, Jesus",
  "Tchau",
  "",
];
for (const s of good) {
  // "Tchau" alone is also a Whisper artifact; accepted either way, only test others.
  if (s === "Tchau") continue;
  check(`legit: ${s}`, !isHallucination(s, "pt"));
}

check("strip word x5", stripRepeats("eu disse não não não não não e fui") === "eu disse não e fui");
check("strip phrase x4", stripRepeats("vamos orar vamos orar vamos orar vamos orar agora") === "vamos orar agora");
check("keep x3", stripRepeats("amém amém amém") === "amém amém amém");
check("keep normal", stripRepeats("Deus é bom o tempo todo") === "Deus é bom o tempo todo");
check("no partial word", stripRepeats("a a a a ab") === "a ab");

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("asr-filter checks passed.");
