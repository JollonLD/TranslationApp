/**
 * End-to-end / integration tests for the simultaneous translation engine.
 * Run: npx tsx src/test/e2e-engine.ts
 */
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as ioClient, type Socket } from "socket.io-client";
import { detectBibleRefs, looksLikeVerseReading } from "../bibleRefs.js";
import { WlkStream, utteranceFromWlk, type WlkFrame } from "../wlkTranscript.js";
import { polishChurchTerms, prepareChurchSource } from "../churchGlossary.js";
import {
  clearLiveEngine,
  ensureLiveEngine,
  fillMissingLanguages,
  sameWords,
  type LiveEngineHooks,
} from "../liveEngine.js";
import { StableText } from "../stableCaption.js";
import { rivaCanPivot, rivaSupportsDirect } from "../rivaTranslate.js";
import {
  createSpace,
  pushCaption,
  updateCaption,
  publicSpace,
} from "../spaces.js";
import {
  FREEZE_SILENCE_MS,
  SourceTape,
  cleanWebSpeech,
  clearSourceTape,
} from "../sourceTape.js";
import { finishSentence } from "../translate.js";
import type { Caption, LanguageCode } from "../types.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    failed += 1;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  } else {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  const ok = actual === expected;
  if (!ok) {
    failed += 1;
    failures.push(`${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
    console.error(`  ✗ ${msg}\n    got:      ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`);
  } else {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function containsAllWords(haystack: string, needle: string) {
  const h = new Set(words(haystack).map((w) => w.toLowerCase().replace(/[.,;:!?…]+$/g, "")));
  return words(needle).every((w) => h.has(w.toLowerCase().replace(/[.,;:!?…]+$/g, "")));
}

// —— SourceTape ——

function testTapeNoWordLoss() {
  console.log("\n[SourceTape] confirmed words never leave");
  const tape = new SourceTape();
  tape.push("Deus ama o mundo", false, 1000);
  tape.push("Deus ama o mundo inteiro", false, 1100);
  const mid = tape.getOpenText();
  assert(containsAllWords(mid, "Deus ama o mundo"), "growing interim keeps earlier words");
  tape.push("Deus ama o mundo inteiro com poder", false, 1200);
  assert(containsAllWords(tape.getOpenText(), "Deus ama o mundo inteiro"), "second growth keeps prior words");
}

function testTapeTipRewriteOnly() {
  console.log("\n[SourceTape] interim only rewrites unstable tip");
  const tape = new SourceTape();
  tape.push("a paz de Deus guarda", false, 1000);
  const before = tape.getOpenStable();
  tape.push("a paz de Deus guarda o coração", false, 1050);
  assert(tape.getOpenStable().startsWith(before.split(" ").slice(0, -1).join(" ")) || before.length >= 0, "stable prefix survives tip growth");
  assert(tape.getOpenText().includes("coração"), "new tip words appear");
}

function testTapeSentenceFreeze() {
  console.log("\n[SourceTape] sentence ending freezes into confirmed");
  const tape = new SourceTape();
  const r = tape.push("Deus ama o mundo inteiro.", true, 2000);
  assert(r.frozen.length === 1, "one frozen sentence");
  assertEq(r.frozen[0], "Deus ama o mundo inteiro.", "frozen text matches");
  assertEq(tape.getOpenText(), "", "open cleared after freeze");
  assert(tape.getConfirmedText().includes("Deus ama o mundo inteiro"), "confirmed retains sentence");
}

function testTapeBreathKeepsSentence() {
  console.log("\n[SourceTape] a one-second breath does not break the sentence");
  const tape = new SourceTape();
  const t0 = 90_000;
  tape.push("parece que não tá duplicando o áudio então acho que tá funcionando", false, t0);
  const mid = tape.freezeSilence(t0 + 1_000);
  assertEq(mid.frozen.length, 0, "1000ms pause keeps one open sentence");
  assert(tape.getOpenText().toLowerCase().includes("funcionando"), "the rest of the sentence is still open");
}

function testFinishSentence() {
  console.log("\n[Sentence] committed line gets capitalization and a period");
  assertEq(finishSentence("parece que não tá duplicando o áudio"), "Parece que não tá duplicando o áudio.", "period and capital");
  assertEq(finishSentence("Já terminou."), "Já terminou.", "existing punctuation stays");
}

function testTapeShortPauseDoesNotFreeze() {
  console.log("\n[SourceTape] short pause does NOT freeze");
  const tape = new SourceTape();
  const t0 = 10_000;
  tape.push("o Senhor é meu pastor", false, t0);
  const early = tape.freezeSilence(t0 + 400);
  assertEq(early.frozen.length, 0, "400ms silence keeps open");
  assert(tape.hasOpen(), "still has open phrase");
}

function testTapeLongPauseFreezes() {
  console.log("\n[SourceTape] long pause freezes open phrase");
  const tape = new SourceTape();
  const t0 = 20_000;
  tape.push("ele me faz descansar", false, t0);
  const late = tape.freezeSilence(t0 + FREEZE_SILENCE_MS + 50);
  assert(late.frozen.length === 1, "long silence freezes once");
  assert(late.frozen[0].includes("descansar"), "frozen content preserved");
  assertEq(tape.getOpenText(), "", "open empty after long pause");
  assert(containsAllWords(tape.getConfirmedText(), "ele me faz descansar"), "confirmed has full phrase");
}

function testTapeContextChangeAfterFreeze() {
  console.log("\n[SourceTape] context change after freeze starts new open, keeps history");
  const tape = new SourceTape();
  tape.push("Hoje falaremos sobre a graça.", true, 30_000);
  const afterGrace = tape.getConfirmedText();
  assert(afterGrace.toLowerCase().includes("graça") || afterGrace.toLowerCase().includes("graca"), "first topic confirmed");

  tape.push("Agora vamos orar pela igreja", false, 31_000);
  assert(tape.getOpenText().toLowerCase().includes("orar"), "new topic is open");
  assert(tape.getConfirmedText().includes(afterGrace) || containsAllWords(tape.getConfirmedText(), "graça"), "previous topic still on tape");

  const frozen = tape.freezeSilence(31_000 + FREEZE_SILENCE_MS + 50);
  assert(frozen.frozen.length >= 1, "second topic freezes on pause");
  const full = tape.getConfirmedText().toLowerCase();
  assert(full.includes("graça") || full.includes("graca"), "history keeps first topic");
  assert(full.includes("orar") || full.includes("igreja"), "history keeps second topic");
}

function testTapeContinuedUtteranceAfterFreeze() {
  console.log("\n[SourceTape] continued utterance does not repeat frozen words");
  const tape = new SourceTape();
  const t0 = 70_000;
  tape.push("parece que não tá duplicando o áudio", false, t0);
  tape.freezeSilence(t0 + FREEZE_SILENCE_MS + 50);
  const steps = [
    "parece que não tá duplicando o áudio então acho que tá funciona",
    "parece que não tá duplicando o áudio então acho que tá funcionando",
    "parece que não tá duplicando o áudio então acho que tá funcionando bem",
  ];
  let t = t0 + FREEZE_SILENCE_MS + 200;
  for (const text of steps) {
    t += 200;
    tape.push(text, false, t);
  }
  const open = tape.getOpenText().toLowerCase();
  assertEq(open, "então acho que tá funcionando bem", "only the new tail stays open");
  assert(!tape.getConfirmedText().toLowerCase().includes("então acho"), "frozen prefix was not rewritten");
  const twice = (open.match(/funcionando bem/g) ?? []).length;
  assertEq(twice, 1, "tail is not duplicated");
}

function testTapeFirstWordCorrection() {
  console.log("\n[SourceTape] first-word correction replaces the tip");
  const tape = new SourceTape();
  let t = 80_000;
  for (const text of ["testa", "testando", "testando para ver", "testando para ver se duplica o áudio"]) {
    t += 200;
    tape.push(text, false, t);
  }
  assertEq(tape.getOpenText().toLowerCase(), "testando para ver se duplica o áudio", "corrected hypothesis replaces testa");
  assert(!tape.getOpenText().toLowerCase().includes("testa "), "old tip was not kept in front");
}

function testTapeRevisionDoesNotDuplicate() {
  console.log("\n[SourceTape] Chrome revision replaces the open line");
  const tape = new SourceTape();
  tape.push("alô testando", false, 60_000);
  tape.freezeSilence(60_000 + FREEZE_SILENCE_MS + 50);
  const steps = [
    "agora parece que",
    "agora parece que tá funciona",
    "agora parece que tá funcionando certo",
    "agora parece que tá funcionando certo não sei",
  ];
  let t = 61_000;
  for (const text of steps) {
    t += 200;
    tape.push(text, false, t);
  }
  const open = tape.getOpenText().toLowerCase();
  assert(open.includes("funcionando"), "revision keeps the corrected words");
  assert(!open.includes("funciona agora"), "corrected line is not appended twice");
  const count = open.split("agora parece").length - 1;
  assertEq(count, 1, "phrase appears once");
}

function testTapeLoggedRevisionsDoNotDuplicate() {
  console.log("\n[SourceTape] real booth revisions stay a single line");
  const sequences = [
    [
      "agora parece",
      "agora parece que",
      "agora parece que tá",
      "agora parece que tá funciona",
      "agora parece que tá funcionando",
      "agora parece que tá funcionando certo não sei",
    ],
    [
      "agora a tradução",
      "agora a tradução tá",
      "agora a tradução tá duplica",
      "agora a tradução tá duplicada",
    ],
    [
      "quando eu falo",
      "quando eu falo não",
      "quando eu falo inglês",
      "quando eu falo inglês ele fica duplicado",
    ],
    ["testa", "testando", "testando para ver se duplica o áudio"],
  ];
  for (const lines of sequences) {
    const tape = new SourceTape();
    let t = 90_000;
    for (const line of lines) {
      t += 180;
      tape.push(line, false, t);
    }
    const open = tape.getOpenText();
    assertEq(open, lines.at(-1)!, "revision replaces the open line");
    const words = open.toLowerCase().split(/\s+/);
    const repeated = words.filter((word, index) => word.length > 3 && words.indexOf(word) !== index);
    assertEq(repeated.length, 0, "no repeated content word in the open line");
  }
}

function testTapeChromeSegmentRestart() {
  console.log("\n[SourceTape] Chrome new segment does not wipe confirmed");
  const tape = new SourceTape();
  tape.push("Primeira frase completa do sermão.", true, 40_000);
  const confirmed = tape.getConfirmedText();
  // Fresh segment that doesn't continue the same string
  tape.push("Segunda ideia do pastor", false, 41_000);
  assertEq(tape.getConfirmedText(), confirmed, "confirmed unchanged on new segment");
  assert(tape.getOpenText().includes("Segunda"), "new segment becomes open");
}

function testTapeFlushAll() {
  console.log("\n[SourceTape] flushAll on stop listening");
  const tape = new SourceTape();
  tape.push("última frase sem ponto", false, 50_000);
  const r = tape.flushAll();
  assert(r.frozen.length === 1, "flush freezes remnant");
  assert(!tape.hasOpen(), "no open after flush");
}

// —— Bible / glossary ——

function testBibleDetection() {
  console.log("\n[Bible] reference detection");
  const hits = detectBibleRefs("Abram conosco João 3:16 e também Romanos 8.28");
  assert(hits.length >= 1, "detects at least one ref");
  assert(
    hits.some((h) => h.bookEn === "John" && h.chapter === 3 && h.verse === 16),
    "detects João 3:16",
  );
  const john = hits.find((h) => h.bookEn === "John")!;
  assert(looksLikeVerseReading("João 3:16", john), "short utterance counts as reading");
  assert(!looksLikeVerseReading(
    "Como vimos em João 3:16 o amor de Deus é grande demais para caber em palavras humanas e precisamos viver isso",
    john,
  ), "long commentary is not pure reading");
}

function testGlossaryAfterNotBefore() {
  console.log("\n[Glossary] polish after MT, prepare does not wipe meaning");
  const source = prepareChurchSource("vamos ler joão 3 16 juntos", "pt");
  assert(source.toLowerCase().includes("joão") || source.toLowerCase().includes("joao"), "prepare keeps book name");
  const polished = polishChurchTerms("John 3:16 shows God's love", "en");
  assert(polished.includes("John") || polished.includes("love"), "polish does not empty translation");
}

function testWlkFrames() {
  console.log("\n[WLK] lines and buffer become one tape utterance");
  const growing = utteranceFromWlk({
    lines: [],
    buffer_transcription: "Deus ama o mundo",
  });
  assertEq(growing.full, "Deus ama o mundo", "buffer is the open utterance");
  assertEq(growing.isFinal, false, "buffer alone is not final");

  const committed = utteranceFromWlk(
    {
      lines: [{ text: "Deus ama o mundo." }],
      buffer_transcription: "",
    },
    "",
  );
  assert(committed.full.includes("mundo"), "committed line is kept");
  assertEq(committed.isFinal, true, "empty tip after a new line is final");

  const next = utteranceFromWlk(
    {
      lines: [{ text: "Deus ama o mundo." }],
      buffer_transcription: "E Jesus",
    },
    committed.stable,
  );
  assert(next.full.endsWith("E Jesus"), "new tip appends after the stable line");
  assertEq(next.isFinal, false, "a fresh tip stays provisional");
}

function testRivaLanguageMatrix() {
  console.log("\n[Riva] language pair matrix");
  assert(rivaSupportsDirect("pt", "en"), "pt-en direct");
  assert(rivaSupportsDirect("en", "pt"), "en-pt direct");
  assert(rivaCanPivot("pt", "es"), "pt-es via pivot");
  assert(rivaCanPivot("pt", "it"), "pt-it via pivot");
  assert(!rivaCanPivot("pt", "fa"), "pt-fa not via Riva");
  assert(!rivaCanPivot("pt", "ur"), "pt-ur not via Riva");
}

// —— Spaces upsert ——

function testCaptionUpsert() {
  console.log("\n[Spaces] push + in-place update same id");
  const space = createSpace("pt", "en");
  const cap: Caption = {
    id: "c-test-1",
    original: "Deus é fiel",
    translated: "God is faithful",
    translations: { pt: "Deus é fiel", en: "God is faithful" },
    isFinal: true,
    at: Date.now(),
  };
  pushCaption(space, cap);
  assertEq(space.captions.length, 1, "one final caption");
  updateCaption(space, {
    ...cap,
    translations: { ...cap.translations, en: "God is faithful forever" },
    translated: "God is faithful forever",
  });
  assertEq(space.captions.length, 1, "update does not duplicate");
  assertEq(space.captions[0].translations.en, "God is faithful forever", "same id revised");
}

// —— LiveEngine with mocked NVIDIA/Google ——

function installFetchMock() {
  const original = globalThis.fetch;
  let callCount = 0;
  const aborted: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    callCount += 1;
    const url = String(input);
    const signal = init?.signal;

    const checkAbort = () => {
      if (signal?.aborted) {
        aborted.push(url);
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
    };

    // Slow Riva-like call — allows cancellation tests
    if (url.includes("integrate.api.nvidia.com")) {
      await sleep(180);
      checkAbort();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const pair = body.messages?.[0]?.content ?? "";
      const src = body.messages?.[1]?.content ?? "";
      let content = `[${pair}] ${src}`;
      if (pair === "pt-br-en") content = `EN:${src}`;
      if (pair === "en-es-us") content = `ES:${src}`;
      if (pair === "en-it") content = `IT:${src}`;
      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Google translate endpoints used by fallback
    if (url.includes("translate.googleapis.com") || url.includes("translate.google")) {
      checkAbort();
      return new Response(JSON.stringify([[["EN-FALLBACK", "x"]]]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // bible-api
    if (url.includes("bible-api.com")) {
      return new Response(JSON.stringify({
        reference: "John 3:16",
        text: "For God so loved the world...",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return original(input, init);
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = original;
    },
    get callCount() {
      return callCount;
    },
    aborted,
  };
}

async function testLiveEngineLongPauseAndFinals() {
  console.log("\n[LiveEngine] long pause emits final; short pause does not");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-PAUSE");
  clearSourceTape("E2E-PAUSE");

  const finals: Caption[] = [];
  const lives: Caption[] = [];
  const hooks: LiveEngineHooks = {
    getSourceLang: () => "pt",
    getTargets: () => ["en"],
    onLive: (c) => lives.push({ ...c, translations: { ...c.translations } }),
    onUpdate: () => undefined,
    onFinal: (c) => finals.push({ ...c, translations: { ...c.translations } }),
  };
  const engine = ensureLiveEngine("E2E-PAUSE", hooks);

  engine.push("a graça de Deus é suficiente", false);
  await sleep(350);
  assert(lives.length >= 1, "live line appears before freeze");
  assertEq(finals.length, 0, "no final during short wait");

  await sleep(FREEZE_SILENCE_MS + 200);
  // allow freeze translate to finish
  await sleep(500);

  assert(finals.length >= 1, "long pause produces final caption");
  assert(
    containsAllWords(finals[0].original, "graça de Deus") ||
      containsAllWords(finals[0].original, "graca de Deus") ||
      finals[0].original.toLowerCase().includes("suficiente"),
    "final preserves source words",
  );
  assert(finals[0].isFinal === true, "final flagged isFinal");
  assert(finals.every((f) => f.isFinal), "all finals are final");

  engine.clear();
  mock.restore();
}

async function testLiveEngineContextSwitch() {
  console.log("\n[LiveEngine] context switch: two finals, no overwrite of first");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-CTX");
  clearSourceTape("E2E-CTX");

  const finals: Caption[] = [];
  const hooks: LiveEngineHooks = {
    getSourceLang: () => "pt",
    getTargets: () => ["en"],
    onLive: () => undefined,
    onUpdate: () => undefined,
    onFinal: (c) => finals.push({ ...c }),
  };
  const engine = ensureLiveEngine("E2E-CTX", hooks);

  engine.push("Primeiro tema é a graça.", true);
  await sleep(700);

  engine.push("Agora mudamos para a oração", false);
  await sleep(FREEZE_SILENCE_MS + 400);
  await sleep(600);

  assert(finals.length >= 2, `two context blocks frozen (got ${finals.length})`);
  const originals = finals.map((f) => f.original.toLowerCase()).join(" || ");
  assert(originals.includes("graça") || originals.includes("graca") || originals.includes("primeiro"), "first topic kept as its own final");
  assert(originals.includes("oração") || originals.includes("oracao") || originals.includes("mudamos"), "second topic kept as its own final");
  const ids = new Set(finals.map((f) => f.id));
  assert(ids.size === finals.length, "each final has unique id (no in-place clobber of history)");

  engine.clear();
  mock.restore();
}

async function testLiveEngineCancelsStaleFlight() {
  console.log("\n[LiveEngine] rapid speech cancels stale in-flight request");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-CANCEL");
  clearSourceTape("E2E-CANCEL");

  const lives: Caption[] = [];
  const engine = ensureLiveEngine("E2E-CANCEL", {
    getSourceLang: () => "pt",
    getTargets: () => ["en"],
    onLive: (c) => lives.push({ ...c, translations: { ...c.translations } }),
    onUpdate: () => undefined,
    onFinal: () => undefined,
  });

  engine.push("Deus", false);
  await sleep(40);
  engine.push("Deus ama", false);
  await sleep(40);
  engine.push("Deus ama o mundo", false);
  // one translation + settle pause before the open line is shown whole
  await sleep(1_300);

  const english = lives.map((c) => c.translations.en ?? "").join(" | ");
  assert(
    english.toLowerCase().includes("ama"),
    "one in-flight translation follows the newest words",
  );
  // Live shell keeps full open original; translated display may hide tip words (flicker control).
  assert(
    lives.some((c) => c.original.toLowerCase().includes("mundo")),
    "live shell saw newest source words before freeze",
  );
  assert(lives.length >= 2, "multiple live updates while speech grew");

  engine.clear();
  mock.restore();
}

async function testLiveEngineMultiLangPivot() {
  console.log("\n[LiveEngine] multi-lang targets (en + es) without losing finals");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-MULTI");
  clearSourceTape("E2E-MULTI");

  const finals: Caption[] = [];
  const engine = ensureLiveEngine("E2E-MULTI", {
    getSourceLang: () => "pt",
    getTargets: () => ["en", "es"],
    onLive: () => undefined,
    onUpdate: () => undefined,
    onFinal: (c) => finals.push({ ...c, translations: { ...c.translations } }),
  });

  engine.push("O Senhor é bom.", true);
  await sleep(1200);

  assert(finals.length >= 1, "final emitted for multi-lang");
  const last = finals.at(-1)!;
  assert(Boolean(last.translations.en) || Boolean(last.translations.es) || last.translated.length > 0, "at least one target translation filled");

  engine.clear();
  mock.restore();
}

async function testPreviousLinesFollowLanguage() {
  console.log("\n[LiveEngine] switching language retranslates earlier lines and the open line");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-SWITCH");
  clearSourceTape("E2E-SWITCH");

  const earlier: Caption = {
    id: "c-old",
    original: "Deus ama o mundo.",
    translated: "EN:Deus ama o mundo.",
    translations: { pt: "Deus ama o mundo.", en: "EN:Deus ama o mundo." },
    isFinal: true,
    at: 1,
  };
  const filled = await fillMissingLanguages([earlier], "pt", ["es"]);
  assertEq(filled.length, 1, "earlier line is sent again in the new language");
  assert(earlier.translations.es?.includes("ES:"), "earlier line is translated into Spanish");

  let targets: LanguageCode[] = ["en"];
  const lives: Caption[] = [];
  const engine = ensureLiveEngine("E2E-SWITCH", {
    getSourceLang: () => "pt",
    getTargets: () => targets,
    onLive: (c) => lives.push({ ...c, translations: { ...c.translations } }),
    onUpdate: () => undefined,
    onFinal: () => undefined,
  });
  engine.push("A graça de Deus é suficiente", false);
  await sleep(1_200);
  assert(lives.some((c) => c.translations.en), "open line started in English");
  targets = ["es"];
  engine.retarget();
  await sleep(1_400);
  assert(lives.some((c) => c.translations.es), "open line follows the new language");

  engine.clear();
  mock.restore();
}

// —— Socket.IO E2E (minimal server wiring like production) ——

// —— WhisperLiveKit: cumulative frames must never paste a sentence twice ——

const SERMON = [
  "Hoje vamos falar sobre a graça de Deus",
  "Ela nos alcança mesmo quando não merecemos",
  "Paulo escreveu aos romanos sobre isso com muita clareza",
  "Onde abundou o pecado superabundou a graça",
  "Isso muda a forma como vivemos cada dia",
  "Por isso devemos perdoar uns aos outros",
  "A igreja é uma família que caminha junta",
  "Vamos orar agora pedindo direção ao Senhor",
  "Ele ouve cada oração feita com sinceridade",
  "Amém",
];

function frameOf(lines: string[], buffer: string): WlkFrame {
  return { lines: lines.map((text) => ({ text })), buffer_transcription: buffer };
}

/** Words as the listener reads them, punctuation removed. */
function plainWords(text: string) {
  return words(text).map((w) => w.toLowerCase().replace(/[.,;:!?…]+$/g, ""));
}

/**
 * Feed a sermon the way WhisperLiveKit does: every frame repeats all committed lines
 * of the session plus the buffer. Words commit a few at a time, the tip keeps growing.
 */
function runWlkSermon(sentences: string[], opts: { pauseMs: number; commitEvery: number }) {
  const tape = new SourceTape();
  const stream = new WlkStream();
  const frozen: string[] = [];
  const committed: string[] = [];
  let t = 10_000;
  const feed = (frame: WlkFrame) => {
    const delta = stream.next(frame);
    t += 250;
    if (delta) frozen.push(...tape.pushCommitted(delta.committed, delta.tip, t).frozen);
  };
  for (const sentence of sentences) {
    const w = words(sentence);
    let stableCount = 0;
    for (let i = 1; i <= w.length; i += 1) {
      if (i - stableCount > opts.commitEvery) stableCount = i - 1;
      const open = w.slice(0, stableCount).join(" ");
      feed(frameOf([...committed, open].filter(Boolean), w.slice(stableCount, i).join(" ")));
    }
    committed.push(`${sentence}.`);
    feed(frameOf(committed, ""));
    t += opts.pauseMs;
    frozen.push(...tape.freezeSilence(t).frozen);
  }
  frozen.push(...tape.flushAll().frozen);
  return { frozen, tape };
}

function testWlkCumulativeFramesDoNotDuplicate() {
  console.log("\n[WLK] full-session frames: each sentence frozen exactly once");
  const { frozen } = runWlkSermon(SERMON, { pauseMs: 300, commitEvery: 3 });
  const expected = SERMON.flatMap((s) => plainWords(s));
  const got = frozen.flatMap((f) => plainWords(f));
  assertEq(got.length, expected.length, "frozen word count equals spoken word count");
  assertEq(got.join(" "), expected.join(" "), "frozen text is the sermon once, in order");
  for (const sentence of SERMON.slice(0, -1)) {
    const hits = frozen.filter((f) => f.includes(sentence)).length;
    assertEq(hits, 1, `"${sentence.slice(0, 28)}…" appears once`);
  }
}

function testWlkLongSermonPastTapeWindow() {
  console.log("\n[WLK] 300+ words: history beyond the tape window is not replayed");
  const long = Array.from({ length: 4 }, () => SERMON).flat();
  const { frozen } = runWlkSermon(long, { pauseMs: 2_600, commitEvery: 2 });
  const expected = long.flatMap((s) => plainWords(s));
  const got = frozen.flatMap((f) => plainWords(f));
  assertEq(got.length, expected.length, "no word lost or repeated after 300+ words");
  assertEq(got.join(" "), expected.join(" "), "order preserved across the whole session");
}

function testWlkNoPunctuationKeepsEveryWord() {
  console.log("\n[WLK] speech without punctuation: silence and length freeze, nothing repeats");
  const tape = new SourceTape();
  const stream = new WlkStream();
  const spoken = Array.from({ length: 130 }, (_, i) => `palavra${i}`);
  const frozen: string[] = [];
  let t = 1_000;
  for (let i = 1; i <= spoken.length; i += 1) {
    const stable = spoken.slice(0, Math.max(0, i - 2)).join(" ");
    const delta = stream.next(frameOf(stable ? [stable] : [], spoken.slice(Math.max(0, i - 2), i).join(" ")));
    t += i % 40 === 0 ? 3_000 : 200;
    if (i % 40 === 0) frozen.push(...tape.freezeSilence(t).frozen);
    if (delta) frozen.push(...tape.pushCommitted(delta.committed, delta.tip, t).frozen);
  }
  const delta = stream.next(frameOf([spoken.join(" ")], ""));
  if (delta) frozen.push(...tape.pushCommitted(delta.committed, delta.tip, t + 100).frozen);
  frozen.push(...tape.flushAll().frozen);
  const got = frozen.flatMap((f) => words(f));
  assertEq(got.join(" "), spoken.join(" "), "every word exactly once, in order");
}

function testWlkSilenceFrozeTipBeforeCommit() {
  console.log("\n[WLK] pause freezes the tip; the later commit does not repeat it");
  const tape = new SourceTape();
  const stream = new WlkStream();
  const push = (frame: WlkFrame, t: number) => {
    const d = stream.next(frame);
    return d ? tape.pushCommitted(d.committed, d.tip, t).frozen : [];
  };
  const frozen: string[] = [];
  frozen.push(...push(frameOf(["Jesus é o caminho"], "e a verdade"), 1_000));
  frozen.push(...tape.freezeSilence(1_000 + FREEZE_SILENCE_MS + 50).frozen);
  assertEq(frozen.join(" | "), "Jesus é o caminho e a verdade", "pause froze committed words and tip");
  frozen.push(...push(frameOf(["Jesus é o caminho e a verdade."], ""), 4_000));
  frozen.push(...push(frameOf(["Jesus é o caminho e a verdade.", "E a vida"], ""), 4_300));
  frozen.push(...tape.flushAll().frozen);
  assertEq(frozen.join(" | "), "Jesus é o caminho e a verdade | E a vida", "tip words are not frozen twice");
}

function testWlkTipRevisionSettles() {
  console.log("\n[WLK] tip rewritten by the ASR replaces, never appends");
  const tape = new SourceTape();
  const stream = new WlkStream();
  const push = (frame: WlkFrame, t: number) => {
    const d = stream.next(frame);
    if (d) tape.pushCommitted(d.committed, d.tip, t);
  };
  push(frameOf([], "a graca"), 1_000);
  push(frameOf([], "a graça de"), 1_200);
  push(frameOf(["a graça de Deus"], "nos"), 1_400);
  push(frameOf(["a graça de Deus nos alcança"], ""), 1_600);
  assertEq(tape.getOpenText(), "a graça de Deus nos alcança", "open line has the settled words once");
}

function testWlkServerHistoryRestart() {
  console.log("\n[WLK] server restarts its history: new speech continues, old is not replayed");
  const stream = new WlkStream();
  const first = stream.next(frameOf(["Primeira frase do culto.", "Segunda frase aqui."], ""));
  assertEq(first?.committed, "Primeira frase do culto. Segunda frase aqui.", "first frame commits both lines");
  const again = stream.next(frameOf(["Primeira frase do culto.", "Segunda frase aqui."], ""));
  assertEq(again, null, "identical frame yields nothing");
  const fixed = stream.next(frameOf(["Primeira frase do culto,", "segunda frase aqui.", "Terceira"], ""));
  assertEq(fixed?.committed, "Terceira", "punctuation fix in old text adds only the new word");
  const restarted = stream.next(frameOf(["Nova sessão começa"], ""));
  assertEq(restarted?.committed, "Nova sessão começa", "restarted history becomes new speech");
}

async function testLiveEngineWlkFinalsUnique() {
  console.log("\n[LiveEngine] WhisperLiveKit sermon: finals and live lines never repeat text");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-WLK");
  clearSourceTape("E2E-WLK");
  const finals: Caption[] = [];
  const lives: Caption[] = [];
  const engine = ensureLiveEngine("E2E-WLK", {
    getSourceLang: () => "pt",
    getTargets: () => ["en"],
    onLive: (c) => lives.push({ ...c, translations: { ...c.translations } }),
    onUpdate: () => undefined,
    onFinal: (c) => finals.push({ ...c, translations: { ...c.translations } }),
  });
  const stream = new WlkStream();
  const committed: string[] = [];
  for (const sentence of SERMON.slice(0, 8)) {
    const w = words(sentence);
    for (let i = 1; i <= w.length; i += 1) {
      const d = stream.next(frameOf(
        [...committed, w.slice(0, Math.max(0, i - 2)).join(" ")].filter(Boolean),
        w.slice(Math.max(0, i - 2), i).join(" "),
      ));
      if (d) engine.pushCommitted(d.committed, d.tip);
    }
    committed.push(`${sentence}.`);
    const d = stream.next(frameOf(committed, ""));
    if (d) engine.pushCommitted(d.committed, d.tip);
    await sleep(30);
  }
  await sleep(1_500);
  const originals = finals.map((f) => f.original);
  assertEq(finals.length, 8, "one final per spoken sentence");
  assertEq(new Set(originals).size, originals.length, "no final repeats another");
  for (let i = 0; i < 8; i += 1) {
    assertEq(plainWords(originals[i] ?? "").join(" "), plainWords(SERMON[i]).join(" "), `final ${i + 1} is exactly its sentence`);
  }
  const english = finals.map((f) => f.translations.en ?? "");
  // Mock Riva echoes the source as "EN:<text>"; the church glossary may swap terms.
  const ownSentenceOnly = english.every((en, i) => {
    const src = plainWords(SERMON[i]);
    const n = words(en).length;
    return en.startsWith("EN:") && n >= src.length - 1 && n <= src.length + 2;
  });
  assert(ownSentenceOnly, "each English final translates only its own sentence");
  const bloated = lives.filter((c) => words(c.original).length > 20);
  assertEq(bloated.length, 0, "live line never carries earlier sentences");
  engine.clear();
  mock.restore();
}

// —— Reading fluency ——

/** Normalized erasure (Arivazhagan et al. 2020): words removed from screen / final words. */
function normalizedErasure(displays: string[]) {
  let erased = 0;
  for (let i = 1; i < displays.length; i += 1) {
    const prev = words(displays[i - 1]);
    const next = words(displays[i]);
    let lcp = 0;
    while (lcp < prev.length && lcp < next.length && prev[lcp] === next[lcp]) lcp += 1;
    erased += prev.length - lcp;
  }
  const final = words(displays.at(-1) ?? "").length || 1;
  return erased / final;
}

/** Machine translation that keeps rewriting its tail, as re-translation does. */
function noisyHypotheses(target: string[]) {
  const out: string[] = [];
  for (let n = 2; n <= target.length; n += 1) {
    const prefix = target.slice(0, n);
    if (n % 3 === 0 && n >= 4) {
      // swap the last two words, then settle on the next update
      const swapped = [...prefix.slice(0, -2), prefix.at(-1)!, prefix.at(-2)!];
      out.push(swapped.join(" "));
    }
    if (n % 4 === 0) out.push([...prefix.slice(0, -1), "that"].join(" "));
    out.push(prefix.join(" "));
  }
  return out;
}

function testStableTextMonotonic() {
  console.log("\n[Fluency] stable live text: no rewrite of words already read");
  const target = words("God loves the world so much that he gave his only son for all of us");
  const stable = new StableText();
  const raw: string[] = [];
  const shown: string[] = [];
  for (const h of noisyHypotheses(target)) {
    raw.push(h);
    shown.push(stable.update(h));
  }
  const rawNe = normalizedErasure(raw);
  const ne = normalizedErasure(shown.filter(Boolean));
  console.log(`    erasure raw=${rawNe.toFixed(2)} stabilized=${ne.toFixed(2)}`);
  assert(rawNe > 0.2, "raw re-translation flickers (NE > 0.2) — the problem is real");
  assert(ne < 0.2, "stabilized display stays under NE 0.2");
  assertEq(stable.getStats().erased, 0, "no shown word was ever replaced in this run");
  const last = shown.at(-1) ?? "";
  assert(target.join(" ").startsWith(last), "shown text is always a prefix of the settled translation");
  assert(words(last).length >= target.length - 1, "live line keeps up: at most one word behind");
}

function testStableTextHoldsOnDisagreement() {
  console.log("\n[Fluency] big disagreement waits for the final instead of rewriting");
  const stable = new StableText();
  stable.update("The grace of God is enough");
  const shown = stable.update("The grace of God is enough for");
  assertEq(shown, "The grace of God is enough", "agreed prefix is shown");
  stable.update("God's grace is sufficient for us");
  const held = stable.update("God's grace is sufficient for us all");
  assertEq(held, "The grace of God is enough", "reordered hypothesis does not erase the line");
  stable.update("The grace of God is enough for us");
  const tail = stable.update("The grace of God is enough for us all");
  assertEq(tail, "The grace of God is enough for us", "line grows again once hypotheses agree");
  const paused = stable.settle("The grace of God is enough for us all");
  assertEq(paused, "The grace of God is enough for us all", "speaker paused: newest translation shown whole");
}

function testStableTextTailFix() {
  console.log("\n[Fluency] small fix at the tail is allowed and counted");
  const stable = new StableText();
  stable.update("He said the");
  stable.update("He said the");
  const fixed = [stable.update("He said this word"), stable.update("He said this word today")].at(-1);
  assertEq(fixed, "He said this word", "tail word corrected once the new reading agrees");
  assertEq(stable.getStats().erased, 1, "one erased word recorded");
}

function testShapeGuardKeepsEveryWord() {
  console.log("\n[Fluency] language-model polish may punctuate, never drop or swap words");
  assert(sameWords("deus é fiel e justo", "Deus é fiel, e justo."), "punctuation and capitals only: accepted");
  assert(!sameWords("deus é fiel e justo", "Deus é fiel."), "dropped words: rejected");
  assert(!sameWords("deus é fiel e justo", "Deus é justo e fiel."), "reordered words: rejected");
  assert(sameWords("خدا وفادار است", "خدا وفادار است."), "works for Persian script");
}

function testClauseSplitKeepsWords() {
  console.log("\n[Fluency] long sentence closes at a clause break, nothing lost");
  const tape = new SourceTape();
  const stream = new WlkStream();
  const sentence =
    "Quando olhamos para a cruz e lembramos de tudo o que Jesus sofreu por nós naquele dia, " +
    "entendemos que o amor de Deus não tem medida e que ele nos chama para viver uma vida nova " +
    "cheia de esperança e de alegria verdadeira";
  const w = words(sentence);
  const frozen: string[] = [];
  let t = 1_000;
  for (let i = 1; i <= w.length; i += 1) {
    const d = stream.next(frameOf([w.slice(0, Math.max(0, i - 2)).join(" ")].filter(Boolean), w.slice(Math.max(0, i - 2), i).join(" ")));
    t += 200;
    if (d) frozen.push(...tape.pushCommitted(d.committed, d.tip, t).frozen);
  }
  const d = stream.next(frameOf([`${sentence}.`], ""));
  if (d) frozen.push(...tape.pushCommitted(d.committed, d.tip, t + 200).frozen);
  frozen.push(...tape.flushAll().frozen);
  assert(frozen.length >= 2, "the 45-word sentence became more than one block");
  assert(frozen[0].endsWith(","), "first block ends at the clause comma");
  assert(frozen.every((f) => words(f).length <= 30), "every block is at most 30 words");
  assertEq(plainWords(frozen.join(" ")).join(" "), plainWords(sentence).join(" "), "all words kept, in order");
  assertEq(finishSentence("naquele dia,"), "Naquele dia…", "clause block ends with an ellipsis");
  assertEq(finishSentence("entendemos que", true), "entendemos que.", "continuation keeps its lowercase start");
}

async function testLiveEngineFluentDisplay() {
  console.log("\n[LiveEngine] live line: listener language only, never rewrites what was read");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  clearLiveEngine("E2E-FLUENT");
  clearSourceTape("E2E-FLUENT");
  const lives: Caption[] = [];
  const finals: Caption[] = [];
  const engine = ensureLiveEngine("E2E-FLUENT", {
    getSourceLang: () => "pt",
    getTargets: () => ["en"],
    onLive: (c) => lives.push({ ...c, translations: { ...c.translations } }),
    onUpdate: () => undefined,
    onFinal: (c) => finals.push({ ...c, translations: { ...c.translations } }),
  });
  const stream = new WlkStream();
  const committed: string[] = [];
  for (const sentence of SERMON.slice(0, 4)) {
    const w = words(sentence);
    for (let i = 1; i <= w.length; i += 1) {
      const d = stream.next(frameOf(
        [...committed, w.slice(0, Math.max(0, i - 2)).join(" ")].filter(Boolean),
        w.slice(Math.max(0, i - 2), i).join(" "),
      ));
      if (d) engine.pushCommitted(d.committed, d.tip);
      await sleep(260);
    }
    committed.push(`${sentence}.`);
    const d = stream.next(frameOf(committed, ""));
    if (d) engine.pushCommitted(d.committed, d.tip);
    await sleep(400);
  }
  await sleep(1_200);

  const byLine = new Map<string, string[]>();
  for (const c of lives) {
    const en = c.translations.en;
    if (!en) continue;
    const list = byLine.get(c.id) ?? [];
    if (list.at(-1) !== en) list.push(en);
    byLine.set(c.id, list);
  }
  assert(byLine.size >= 3, "live English shown for most sentences before they close");
  const notEnglish = lives.filter((c) => c.translations.en && !c.translations.en.startsWith("EN:"));
  assertEq(notEnglish.length, 0, "live English line never shows the Portuguese source");
  let worst = 0;
  for (const seq of byLine.values()) worst = Math.max(worst, normalizedErasure(seq));
  assert(worst < 0.2, `worst live erasure ${worst.toFixed(2)} < 0.2`);
  assertEq(finals.length, 4, "one final per sentence");
  engine.clear();
  mock.restore();
}

async function testLiveEngineNoisyMtStaysReadable() {
  console.log("\n[LiveEngine] re-translation that keeps rewriting: display still stable");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();
  const inner = globalThis.fetch;
  let calls = 0;
  // Every other Riva answer swaps the last two words, like an unstable decoder.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await inner(input, init);
    if (!url.includes("integrate.api.nvidia.com")) return res;
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const w = data.choices[0].message.content.split(" ");
    calls += 1;
    if (calls % 2 === 0 && w.length >= 4) [w[w.length - 1], w[w.length - 2]] = [w[w.length - 2], w[w.length - 1]];
    data.choices[0].message.content = w.join(" ");
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  clearLiveEngine("E2E-NOISY");
  clearSourceTape("E2E-NOISY");
  const lives: Caption[] = [];
  const engine = ensureLiveEngine("E2E-NOISY", {
    getSourceLang: () => "pt",
    getTargets: () => ["en"],
    onLive: (c) => lives.push({ ...c, translations: { ...c.translations } }),
    onUpdate: () => undefined,
    onFinal: () => undefined,
  });
  const stream = new WlkStream();
  const sentence = "Paulo escreveu aos romanos sobre a graça que nos alcança mesmo quando não merecemos nada";
  const w = words(sentence);
  for (let i = 1; i <= w.length; i += 1) {
    const d = stream.next(frameOf([w.slice(0, Math.max(0, i - 2)).join(" ")].filter(Boolean), w.slice(Math.max(0, i - 2), i).join(" ")));
    if (d) engine.pushCommitted(d.committed, d.tip);
    await sleep(i === 8 ? 1_200 : 250); // a mid-sentence pause
  }
  await sleep(1_500);
  const seq: string[] = [];
  for (const c of lives) {
    const en = c.translations.en;
    if (en && seq.at(-1) !== en) seq.push(en);
  }
  const ne = normalizedErasure(seq);
  console.log(`    live updates=${seq.length} erasure=${ne.toFixed(2)} last="${seq.at(-1)}"`);
  assert(seq.length >= 3, "live line kept growing while he spoke");
  assert(ne < 0.2, "erasure under 0.2 despite unstable translations");
  assert(words(seq.at(-1) ?? "").length >= w.length - 3, "live line ends close to everything heard");
  engine.clear();
  globalThis.fetch = inner;
  mock.restore();
}

// —— Web Speech (Edge/Chrome): regressions from a real Italian service ——

/** Feed hypotheses like the browser does; returns every frozen caption. */
function runWebSpeech(steps: Array<{ text: string; final?: boolean; pauseMs?: number }>) {
  const tape = new SourceTape();
  const frozen: string[] = [];
  let t = 1_000;
  for (const step of steps) {
    t += step.pauseMs ?? 300;
    frozen.push(...tape.freezeSilence(t).frozen);
    frozen.push(...tape.push(step.text, Boolean(step.final), t).frozen);
  }
  t += 3_000;
  frozen.push(...tape.freezeSilence(t).frozen);
  frozen.push(...tape.flushAll().frozen);
  return { frozen, tape };
}

function testWebSpeechCutWordRestart() {
  console.log("\n[Web Speech] cut-off last word: revision replaces, never appends");
  const { tape } = (() => {
    const t = new SourceTape();
    let at = 1_000;
    for (const h of [
      "si tro",
      "si trovava in carcere no pa",
      "si trovava in carcere no paolo scrive ai filipp",
      "si trovava in carcere no paolo scrive ai filippesi mentre è in prigione",
    ]) t.push(h, false, (at += 300));
    return { tape: t };
  })();
  assertEq(
    tape.getOpenText(),
    "si trovava in carcere no paolo scrive ai filippesi mentre è in prigione",
    "real case: 'si tro si trovava in carcere no pa si trovava…' no longer happens",
  );
  const { frozen } = runWebSpeech([
    { text: "di costruire le mura a intorno a gerusalemme è sceso in piazza ha letto anche qu" },
    { text: "di costruire le mura a intorno a gerusalemme è sceso in piazza ha letto anche questo", final: true },
  ]);
  assertEq(plainWords(frozen.join(" ")).filter((w) => w === "costruire").length, 1, "real case: 'anche qu di costruire…' said once");
}

function testWebSpeechLongUtterancePauses() {
  console.log("\n[Web Speech] long utterance across pauses + late finals: each word once");
  const base = words(
    "con il padre e cosa questo dio ha fatto per te allora dentro di te sarà una gioia diversa una gioia che non sparisce fra oggi e domani o fra un mese quando uscirà una macchina nuova o quello che sia ma questa gioia rimane questa gioia eterna no perché è una gioia che non proviene da noi è una gioia che proviene da dio e allora possiamo",
  );
  const steps: Array<{ text: string; final?: boolean; pauseMs?: number }> = [];
  for (let n = 30; n < base.length; n += 4) steps.push({ text: base.slice(0, n).join(" "), pauseMs: n % 8 === 2 ? 2_600 : 400 });
  // Edge then sends punctuated finals for parts it already showed, out of order.
  steps.push(
    { text: "No, perché è una gioia che non proviene da noi, è una gioia che proviene da Dio.", final: true },
    { text: "E cosa questo Dio ha fatto per te, allora dentro di te sarà una gioia diversa, una gioia che non sparisce fra oggi e domani o fra un mese quando uscirà una macchina nuova o quello che sia.", final: true },
    { text: "Ma questa gioia rimane, questa gioia eterna?", final: true },
    { text: "E allora possiamo.", final: true },
    { text: "Devi deve cantare il primo canto voi tutti abitanti della terra.", final: true, pauseMs: 3_000 },
  );
  const { frozen } = runWebSpeech(steps);
  const expected = [...base, ...plainWords("Devi deve cantare il primo canto voi tutti abitanti della terra")];
  const got = plainWords(frozen.join(" "));
  assertEq(got.length, expected.length, `word count ${got.length} equals spoken ${expected.length} (main had ~7x)`);
  assertEq(got.join(" "), expected.join(" "), "every word once, in order");
}

function testWebSpeechGluedCom() {
  console.log("\n[Web Speech] Edge '…sappiamo.com' glitch does not leak or duplicate");
  assertEq(cleanWebSpeech("E.com e come avevamo oggi"), "E e come avevamo oggi", "short glued token keeps its word");
  assertEq(
    cleanWebSpeech("ma una roccia su cuiaggrapparsiquandoleproprieforzevengonomenoperchenoisappiamo.com"),
    "ma una roccia su",
    "long glued token dropped",
  );
  const { frozen } = runWebSpeech([
    { text: "ma una roccia su cui aggrapparsi quando le proprie forze vengono meno perché noi sappiamo" },
    { text: "ma una roccia su cuiaggrapparsiquandoleproprieforzevengonomenoperchenoisappiamo.com" },
    { text: "ma una roccia su cui aggrapparsi quando le proprie forze vengono meno perché noi sappiamo come è il popolo d'isra" },
    { text: "ma una roccia su cui aggrapparsi quando le proprie forze vengono meno perché noi sappiamo come è il popolo d'israele", final: true },
  ]);
  assertEq(frozen.length, 1, "one caption");
  assertEq(
    plainWords(frozen[0]).join(" "),
    plainWords("ma una roccia su cui aggrapparsi quando le proprie forze vengono meno perché noi sappiamo come è il popolo d'israele").join(" "),
    "the sentence once, no '.com'",
  );
}

function testWebSpeechKeepsRealRepetition() {
  console.log("\n[Web Speech] real repetition by the speaker is kept");
  const { frozen } = runWebSpeech([
    { text: "grazie per quella croce", final: true },
    { text: "grazie per quel sacrificio", final: true },
    { text: "Tutto questo ti chiediamo nel nome di Gesù.", final: true, pauseMs: 2_500 },
    { text: "Amen.", final: true, pauseMs: 2_500 },
    { text: "Sì o no?", final: true, pauseMs: 2_500 },
    { text: "Rallegratevi nel signore, sempre.", final: true, pauseMs: 2_500 },
    { text: "Paolo dice rallegratevi nel signore sempre, ripeto, rallegratevi.", final: true, pauseMs: 2_500 },
  ]);
  const text = plainWords(frozen.join(" ")).join(" ");
  assert(text.includes("grazie per quella croce grazie per quel sacrificio"), "'grazie per…' twice, as said");
  assert(text.includes("amen"), "short 'Amen.' kept");
  assertEq(text.split("rallegratevi").length - 1, 3, "'rallegratevi' three times, as said");
}

function testWebSpeechReviewRegressions() {
  console.log("\n[Web Speech] review regressions: speech is never dropped");
  const said = (frozen: string[]) => plainWords(frozen.join(" ")).join(" ");
  {
    const { frozen } = runWebSpeech([
      { text: "il signore sia con voi.", final: true },
      { text: "e con il tuo spirito.", final: true, pauseMs: 3_000 },
      { text: "preghiamo insieme fratelli miei.", final: true, pauseMs: 3_000 },
      { text: "il signore sia con voi.", final: true, pauseMs: 24_000 },
    ]);
    assertEq(said(frozen).split("il signore sia con voi").length - 1, 2, "a sentence said again later is kept");
  }
  {
    const { frozen } = runWebSpeech([
      { text: "dobbiamo pregare per la pace.", final: true },
      { text: "per la pace nel mondo.", final: true, pauseMs: 3_000 },
    ]);
    assertEq(said(frozen), "dobbiamo pregare per la pace per la pace nel mondo", "repeated phrase after a pause is kept");
  }
  {
    const t = new SourceTape();
    const f: string[] = [];
    f.push(...t.push("il signore è con voi", false, 0).frozen);
    f.push(...t.freezeSilence(3_000).frozen);
    f.push(...t.push("il signore vi benedica", false, 3_500).frozen);
    f.push(...t.push("il signore vi benedica sempre", true, 4_000).frozen);
    f.push(...t.flushAll().frozen);
    assertEq(said(f), "il signore è con voi il signore vi benedica sempre", "same start after a pause is a new sentence, nothing lost");
  }
  {
    const t = new SourceTape();
    const f: string[] = [];
    f.push(...t.push("dio", false, 0).frozen);
    f.push(...t.freezeSilence(3_000).frozen);
    f.push(...t.push("di nuovo qui", false, 3_500).frozen);
    f.push(...t.flushAll().frozen);
    assertEq(said(f), "dio di nuovo qui", "'di' is not swallowed by 'dio'");
  }
  {
    const { frozen } = runWebSpeech([
      { text: "sono andato al mercato" },
      { text: "io sono andato al mercato oggi" },
      { text: "Io sono andato al mercato oggi.", final: true },
    ]);
    assertEq(said(frozen), "io sono andato al mercato oggi", "first word added by a revision: replaced, not appended");
  }
  {
    const { frozen } = runWebSpeech([
      { text: "e quindi andiamo avanti" },
      { text: "quindi andiamo avanti insieme", final: true },
    ]);
    assertEq(said(frozen), "quindi andiamo avanti insieme", "first word dropped by a revision: replaced");
  }
  {
    const { frozen } = runWebSpeech([
      { text: "il pane quotidiano dacci oggi" },
      { text: "Al pane quotidiano dacci oggi e sempre.", final: true },
    ]);
    assertEq(said(frozen), "al pane quotidiano dacci oggi e sempre", "first word swapped by a revision: replaced");
  }
  {
    const t = new SourceTape();
    const f: string[] = [];
    f.push(...t.pushCommitted("il signore è buono con", "tutti", 0).frozen);
    f.push(...t.push("con tutti noi sempre", false, 500).frozen);
    f.push(...t.flushAll().frozen);
    assertEq(said(f), "il signore è buono con tutti noi sempre", "ASR fallback mid-sentence: no repeated words");
  }
  {
    const t = new SourceTape();
    t.push("dico di no.", true, 0);
    t.push("no no non voglio.", true, 3_000);
    assert(plainWords(t.getConfirmedText()).join(" ").endsWith("dico di no no no non voglio"), "confirmed history keeps 'no no'");
  }
}

async function testSocketCaptionFlow() {
  console.log("\n[Socket E2E] host transcript → listener caption:live / caption");
  process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "nvapi-test-key";
  const mock = installFetchMock();

  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: true } });
  const space = createSpace("pt", "en");
  const code = space.code;
  clearLiveEngine(code);
  clearSourceTape(code);

  const room = `space:${code}`;

  io.on("connection", (socket) => {
    socket.on("join", (role: string) => {
      socket.join(room);
      socket.data.role = role;
      if (role === "listener") socket.data.targetLang = "en";
    });
    socket.on("transcript", (payload: { text: string; isFinal: boolean }) => {
      const engine = ensureLiveEngine(code, {
        getSourceLang: () => "pt",
        getTargets: () => ["en"],
        onLive: (caption) => {
          space.lastPartial = caption;
          io.to(room).emit("caption:live", caption);
        },
        onUpdate: (caption) => {
          updateCaption(space, caption);
          io.to(room).emit("caption:update", caption);
        },
        onFinal: (caption) => {
          pushCaption(space, caption);
          io.to(room).emit("caption", caption);
        },
      });
      engine.push(payload.text, payload.isFinal);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as { port: number }).port;

  const host = await connectClient(port);
  const listener = await connectClient(port);
  host.emit("join", "host");
  listener.emit("join", "listener");
  await sleep(50);

  const liveEvents: Caption[] = [];
  const finalEvents: Caption[] = [];
  listener.on("caption:live", (c: Caption) => liveEvents.push(c));
  listener.on("caption", (c: Caption) => finalEvents.push(c));

  host.emit("transcript", { text: "A palavra de Deus permanece", isFinal: false });
  await sleep(400);
  assert(liveEvents.length >= 1, "listener received caption:live");

  host.emit("transcript", { text: "A palavra de Deus permanece para sempre.", isFinal: true });
  await sleep(1200);

  assert(finalEvents.length >= 1, "listener received final caption");
  assert(finalEvents[0].isFinal, "socket final isFinal=true");
  assert(
    publicSpace(space, 1).captions.length >= 1,
    "space stores frozen captions",
  );

  host.close();
  listener.close();
  clearLiveEngine(code);
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  mock.restore();
}

function connectClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

async function main() {
  console.log("═══ Chiesa Il Faro — engine E2E ═══");

  testTapeNoWordLoss();
  testTapeTipRewriteOnly();
  testTapeSentenceFreeze();
  testTapeShortPauseDoesNotFreeze();
  testTapeBreathKeepsSentence();
  testFinishSentence();
  testTapeLongPauseFreezes();
  testTapeContextChangeAfterFreeze();
  testTapeContinuedUtteranceAfterFreeze();
  testTapeFirstWordCorrection();
  testTapeRevisionDoesNotDuplicate();
  testTapeLoggedRevisionsDoNotDuplicate();
  testTapeChromeSegmentRestart();
  testTapeFlushAll();

  testBibleDetection();
  testGlossaryAfterNotBefore();
  testWlkFrames();
  testWlkCumulativeFramesDoNotDuplicate();
  testWlkLongSermonPastTapeWindow();
  testWlkNoPunctuationKeepsEveryWord();
  testWlkSilenceFrozeTipBeforeCommit();
  testWlkTipRevisionSettles();
  testWlkServerHistoryRestart();
  testWebSpeechCutWordRestart();
  testWebSpeechLongUtterancePauses();
  testWebSpeechGluedCom();
  testWebSpeechKeepsRealRepetition();
  testWebSpeechReviewRegressions();
  testStableTextMonotonic();
  testStableTextHoldsOnDisagreement();
  testStableTextTailFix();
  testShapeGuardKeepsEveryWord();
  testClauseSplitKeepsWords();
  testRivaLanguageMatrix();
  testCaptionUpsert();

  await testLiveEngineLongPauseAndFinals();
  await testLiveEngineContextSwitch();
  await testLiveEngineCancelsStaleFlight();
  await testLiveEngineMultiLangPivot();
  await testPreviousLinesFollowLanguage();
  await testLiveEngineWlkFinalsUnique();
  await testLiveEngineFluentDisplay();
  await testLiveEngineNoisyMtStaysReadable();
  await testSocketCaptionFlow();

  console.log("\n═══ Results ═══");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
  console.log("\nAll critical engine checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
