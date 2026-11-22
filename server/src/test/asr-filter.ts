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
  "♪",
  "♪ ♪",
  "(aplausos)",
  "sim sim sim sim sim sim sim sim sim sim sim sim sim sim sim sim",
];
for (const s of bad) check(`hallucination: ${s}`, isHallucination(s, "pt"));
check("en pattern in an English sermon", isHallucination("Thanks for watching!", "en"));
check("en subtitles credit", isHallucination("Subtitles by the Amara.org community", "en"));

const badIt = [
  "Sottotitoli creati dalla comunità Amara.org",
  "Sottotitoli a cura di QTSS",
  "Grazie per la visione!",
  "Grazie a tutti per la visione.",
  "Iscriviti al canale",
  "Ciao ciao",
  "Ciao, ciao, ciao",
];
for (const s of badIt) check(`it hallucination: ${s}`, isHallucination(s, "it"));
const goodIt = ["Grazie, Signore", "Ciao", "Grazie per la visione che ci hai dato, Signore", "Alleluia, alleluia, alleluia", "Osanna osanna osanna osanna"];
for (const s of goodIt) check(`it legit: ${s}`, !isHallucination(s, "it"));
check("it pattern not applied to pt", !isHallucination("Iscriviti al canale", "pt"));
check("alleluia x16 is worship", !isHallucination(Array(16).fill("alleluia").join(" "), "it"));
check("osanna x16 is worship", !isHallucination(Array(16).fill("osanna").join(" "), "it"));
check("it word loop still caught", isHallucination(Array(16).fill("allora").join(" "), "it"));

const good = [
  "Obrigado, Senhor",
  "Obrigado por assistir a esta pregação hoje na igreja, irmãos",
  "Amém, amém, amém",
  "Jesus Cristo é o Senhor",
  "Música é uma forma de adoração",
  "Thank you, Jesus",
  "Tchau",
  "Música",
  "Silêncio.",
  "Thank you",
  "Aleluia, aleluia, aleluia, aleluia!",
  "Amém amém amém amém",
  "Santo, santo, santo, santo é o Senhor",
  "aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia aleluia",
  "",
];
for (const s of good) check(`legit: ${s}`, !isHallucination(s, "pt"));

// Speech repeats stay whole; only long Whisper loops are shortened (to three).
const keep = [
  "Santo, santo, santo, santo é o Senhor",
  "Eu te amo, eu te amo, eu te amo, eu te amo, Senhor",
  "Amém, amém, amém, amém.",
  "eu disse não não não não não e fui",
  "Deus é bom o tempo todo",
];
for (const s of keep) check(`speech kept: ${s}`, stripRepeats(s) === s);
check(
  "word loop x10 → 3",
  stripRepeats("e então não não não não não não não não não não fui") === "e então não não não fui",
);
check(
  "phrase loop x7 → 3",
  stripRepeats("vamos orar vamos orar vamos orar vamos orar vamos orar vamos orar vamos orar agora") ===
    "vamos orar vamos orar vamos orar agora",
);

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("asr-filter checks passed.");
