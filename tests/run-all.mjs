// Run every *.test.mjs in this directory sequentially; nonzero exit on failure.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();

let failed = 0;
for (const f of tests) {
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) {
    failed++;
    console.error(`\n✗ ${f} FAILED\n`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} suites passed`);
process.exit(failed ? 1 : 0);
