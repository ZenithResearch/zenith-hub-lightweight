import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { executeOwned } from "../../src/lib/owned-process.mjs";
test("timeout reaps the controller and its descendant before releasing the call", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zenith-process-group-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, "child.pid");
  const source = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
  await assert.rejects(
    executeOwned(process.execPath, ["-e", source, pidFile], {
      timeout: 300,
      maxBuffer: 1024,
      env: { PATH: process.env.PATH },
      shell: false,
    }),
  );
  const pid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
test("output-limit failure also terminates the owned process group", async () => {
  await assert.rejects(
    executeOwned(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000)"],
      { timeout: 3000, maxBuffer: 1024, shell: false },
    ),
  );
});

test("unconfirmed group cleanup is consistently marked even for permission errors", async () => {
  const denied = () => {
    const e = new Error("denied");
    e.code = "EPERM";
    throw e;
  };
  await assert.rejects(
    executeOwned(
      process.execPath,
      ["-e", "process.exit(0)"],
      { timeout: 3000, maxBuffer: 1024, shell: false },
      { signalGroup: denied },
    ),
    { code: "OPERATOR_CLEANUP_UNRESOLVED" },
  );
});
