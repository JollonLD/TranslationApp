import { createLevelClassifier, dbfs, measureBlock, meterFraction } from "./audioLevel";

let failed = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", name);
  }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

check("dbfs(1)=0", near(dbfs(1), 0));
check("dbfs(0.5)=-6.02", near(dbfs(0.5), -6.02));
check("dbfs(0)=floor", dbfs(0) === -90);
const m = measureBlock([0.5, -0.5, 0.5, -0.5]);
check("peak/rms", near(m.peak, 0.5) && near(m.rms, 0.5));
check("meterFraction", meterFraction(0) === 1 && meterFraction(-80) === 0 && near(meterFraction(-30), 0.5));

let c = createLevelClassifier();
check("ok at start", c.push(-50, -60, 0) === "ok");
check("ok at 2.9s", c.push(-50, -60, 2900) === "ok");
check("low at 3s", c.push(-50, -60, 3000) === "low");
check("voice resets low", c.push(-20, -30, 3100) === "ok");

c = createLevelClassifier();
c.push(-50, -60, 0);
check("clip", c.push(-0.5, -10, 5000) === "clip");
check("clip held 1.9s", c.push(-30, -45, 6900) === "clip");
check("clip released", c.push(-30, -45, 7001) !== "clip");

if (failed) process.exit(1);
console.log("audioLevel tests passed");
