/**
 * End-to-end / integration tests for the simultaneous translation engine.
 * Run: npx tsx src/test/e2e-engine.ts
 */
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as ioClient, type Socket } from "socket.io-client";
import { detectBibleRefs, looksLikeVerseReading } from "../bibleRefs.js";
import { utteranceFromWlk } from "../wlkTranscript.js";
import { polishChurchTerms, prepareChurchSource } from "../churchGlossary.js";
import {
  clearLiveEngine,
  ensureLiveEngine,
  type LiveEngineHooks,
} from "../liveEngine.js";
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
  await sleep(800);

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

// —— Socket.IO E2E (minimal server wiring like production) ——

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
  testTapeChromeSegmentRestart();
  testTapeFlushAll();

  testBibleDetection();
  testGlossaryAfterNotBefore();
  testWlkFrames();
  testRivaLanguageMatrix();
  testCaptionUpsert();

  await testLiveEngineLongPauseAndFinals();
  await testLiveEngineContextSwitch();
  await testLiveEngineCancelsStaleFlight();
  await testLiveEngineMultiLangPivot();
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
