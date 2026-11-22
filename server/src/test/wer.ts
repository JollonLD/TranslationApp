/** Tests for tools/wer.ts. Run: tsx src/test/wer.ts */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeForWer, wer, parseWav, runWer, topWords } from "../tools/wer.js";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err instanceof Error ? err.stack : err}`);
  }
}

function wav(rate: number, ch: number, bits: number, pcm: Buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE((rate * ch * bits) / 8, 28);
  h.writeUInt16LE((ch * bits) / 8, 32);
  h.writeUInt16LE(bits, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

await test("identical is 0", () => {
  const r = wer("a b c", "a b c");
  assert.equal(r.wer, 0);
  assert.equal(r.refWords, 3);
});
await test("deletion / insertion / substitution", () => {
  const d = wer("a b c d", "a b d");
  assert.deepEqual([d.deletions, d.insertions, d.substitutions], [1, 0, 0]);
  assert.deepEqual(d.missedWords, ["c"]);
  assert.equal(d.wer, 0.25);
  const i = wer("a b", "a x b");
  assert.deepEqual([i.deletions, i.insertions, i.substitutions], [0, 1, 0]);
  const s = wer("a b c", "a x c");
  assert.deepEqual([s.deletions, s.insertions, s.substitutions], [0, 0, 1]);
});
await test("empty edge cases", () => {
  assert.equal(wer("", "").wer, 0);
  assert.equal(wer("a b", "").deletions, 2);
  assert.equal(wer("", "a").wer, 1);
});
await test("normalization", () => {
  assert.equal(normalizeForWer("Olá, Mundo! Isso é 2024.", "pt"), "olá mundo isso é 2024");
  assert.equal(normalizeForWer("Olá, Mundo!", "pt", true), "ola mundo");
  assert.equal(wer(normalizeForWer("Deus é bom.", "pt"), normalizeForWer("deus É BOM", "pt")).wer, 0);
});
await test("missed words list and top", () => {
  const r = wer("o senhor é o meu pastor", "senhor é meu pastor");
  assert.deepEqual(r.missedWords, ["o", "o"]);
  assert.deepEqual(topWords(r.missedWords), [{ word: "o", count: 2 }]);
});
await test("wav valid", () => {
  assert.equal(parseWav(wav(16000, 1, 16, Buffer.alloc(320, 1))).length, 320);
});
await test("wav invalid", () => {
  const pcm = Buffer.alloc(32);
  assert.throws(() => parseWav(wav(44100, 1, 16, pcm)), /ffmpeg -i in -ar 16000/);
  assert.throws(() => parseWav(wav(16000, 2, 16, pcm)), /16 kHz mono/);
  assert.throws(() => parseWav(wav(16000, 1, 8, pcm)), /16-bit/);
  assert.throws(() => parseWav(Buffer.from("nope")), /RIFF/);
});

await test("CLI flow with fake WLK server", async () => {
  const wsMod = (await import("ws" as string)) as { WebSocketServer: new (o: { port: number }) => any };
  const wss = new wsMod.WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const port = wss.address().port as number;
  let bytes = 0;
  wss.on("connection", (sock: any) => {
    sock.on("message", (data: Buffer) => {
      if (data.length === 0) {
        sock.send(JSON.stringify({ lines: [{ text: "o senhor é meu pastor." }], buffer_transcription: "nada" }));
        sock.send(JSON.stringify({ type: "ready_to_stop" }));
        return;
      }
      bytes += data.length;
      if (bytes === 3200) sock.send(JSON.stringify({ lines: [{ text: "o senhor" }], buffer_transcription: "é" }));
    });
  });
  const dir = await mkdtemp(join(tmpdir(), "wer-"));
  await writeFile(join(dir, "a.wav"), wav(16000, 1, 16, Buffer.alloc(3200 * 3)));
  await writeFile(join(dir, "ref.txt"), "O Senhor é o meu pastor, nada");
  const lines: string[] = [];
  const url = `ws://127.0.0.1:${port}/asr`;
  const r = await runWer(
    ["--audio", join(dir, "a.wav"), "--ref", join(dir, "ref.txt"), "--url", url, "--out", join(dir, "o.json")],
    (l) => lines.push(l),
  );
  assert.equal(r.deletions, 1);
  assert.deepEqual(r.missedWords, ["o"]);
  assert.equal(JSON.parse(await readFile(join(dir, "o.json"), "utf8")).deletions, 1);
  assert.ok(lines.some((l) => l.startsWith("WER:")));
  await writeFile(join(dir, "h.txt"), "o senhor é o meu pastor nada");
  assert.equal((await runWer(["--ref", join(dir, "ref.txt"), "--hyp", join(dir, "h.txt")], () => {})).wer, 0);
  wss.close();
  for (const c of wss.clients) c.terminate();
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(
    runWer(["--audio", join(dir, "a.wav"), "--ref", join(dir, "ref.txt"), "--url", url], () => {}),
    /Could not connect/,
  );
});

if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("all wer tests passed");
