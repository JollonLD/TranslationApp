import assert from "node:assert/strict";
import { createLlmQueue } from "../translate.js";
import { rivaMaxTokens } from "../rivaTranslate.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

async function main() {
  const q = createLlmQueue({ maxCaption: 1, maxBackground: 1 });
  const order: string[] = [];
  const g1 = gate(), g2 = gate();
  const run = (name: string, g?: { p: Promise<void> }) => async () => {
    order.push("start:" + name);
    await g?.p;
    return name;
  };
  const b1 = q.enqueue("background", run("b1", g1));
  const b2 = q.enqueue("background", run("b2"));
  const c1 = q.enqueue("caption", run("c1", g2));
  const c2 = q.enqueue("caption", run("c2"));
  await sleep(10);
  assert.deepEqual(order, ["start:b1", "start:c1"], "1 bg + 1 caption concurrent; b2 waits");
  assert.deepEqual(q.stats().running, { caption: 1, background: 1 });
  g2.open();
  await c1;
  await c2;
  assert.ok(order.includes("start:c2") && !order.includes("start:b2"), "caption passes pending background");
  g1.open();
  assert.equal(await b1, "b1");
  assert.equal(await b2, "b2");

  let t = 0;
  const q2 = createLlmQueue({ now: () => t, captionMaxWaitMs: 4000 });
  const g3 = gate();
  const first = q2.enqueue("caption", async () => {
    await g3.p;
    return "a";
  });
  let ran = false;
  const stale = q2.enqueue("caption", async () => {
    ran = true;
    return "b";
  });
  t = 5000;
  g3.open();
  assert.equal(await first, "a");
  assert.equal(await stale, null);
  assert.equal(ran, false);

  const q3 = createLlmQueue();
  await assert.rejects(
    q3.enqueue("caption", async () => {
      throw new Error("x");
    }),
  );
  assert.equal(await q3.enqueue("caption", async () => 1), 1);

  assert.equal(rivaMaxTokens("hi"), 32);
  assert.equal(rivaMaxTokens("a".repeat(30)), Math.ceil(10 * 2.5) + 16);
  assert.equal(rivaMaxTokens("a".repeat(3000)), 512);
  console.log("llm-queue tests passed.");
}
main();
