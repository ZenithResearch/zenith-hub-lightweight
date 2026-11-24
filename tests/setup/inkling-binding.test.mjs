import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { mkdtemp, mkdir, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { digest } from "../../src/lib/setup/catalog.mjs";
import { atomic } from "../../src/lib/setup/state.mjs";
import { hermesModels } from "../../src/lib/setup/hermes-models.mjs";

async function fixture(t, running = false) {
  const setupRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "hub-engine-binding-")));
  const root = path.join(setupRoot, "instances", "fixture");
  await mkdir(path.join(root, "cache"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, "config"), { mode: 0o700 });
  await writeFile(path.join(root, "controller.py"), "original-controller", { mode: 0o600 });
  const manifest = await readFile("profiles/setup/hermes-models.json");
  const receipt = { componentId: "hermes", instanceId: "fixture", installed: true,
    source: { commit: JSON.parse(manifest).hermesCommit }, environment: "environment-deadbeef",
    controllerSha256: digest("original-controller"), unrelated: "retained" };
  await atomic(path.join(root, "receipt.json"), receipt);
  if (running) await atomic(path.join(root, "process.json"), { pid: process.pid });
  const socket = path.join(setupRoot, "socket");
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(setupRoot, { recursive: true, force: true }); });
  const identity = digest((await readFile("scripts/setup/hermes-models.py")) + manifest +
    (await readFile("scripts/setup/hermes-runtime.py")) + root + JSON.stringify([path.join(root, "data"), null]));
  await atomic(path.join(root, "cache/model-manager.json"),
    { pid: process.pid, socket, identity, token: "fixture-not-a-credential" });
  const calls = [];
  const manager = hermesModels({ setupRoot, request: async (_binding, body) => {
    calls.push(body.action);
    if (body.action === "ping") return { protocol: "zenith.hermes-model-manager.v1", identity };
    if (body.action === "local-start") return { job_id: "fixture-job" };
    if (body.action === "local-job") return { job: { status: "done", phase: "done" },
      configuration: { providerId: "llamacpp", modelName: "Inkling-2-Mini-UD-Q4_K_XL", contextLength: 65536 } };
    throw Error("Unexpected fixture action");
  }});
  const plan = { root, digest: "fixture-plan", instanceId: "fixture", componentId: "hermes",
    config: { providerId: "llamacpp", localModelId: "inkling-2-mini" } };
  return { root, receipt, calls, manager, plan };
}

test("reviewed local setup persists an attested private adapter/catalog and native configuration", async (t) => {
  const f = await fixture(t);
  const result = await f.manager.setupLocal(f.plan);
  assert.equal(result.backend.contextLength, 65536);
  assert.equal(result.backend.providerId, "llamacpp");
  const receipt = JSON.parse(await readFile(path.join(f.root, "receipt.json")));
  assert.equal(receipt.unrelated, "retained");
  assert.equal(receipt.backendConfigured, true);
  assert.equal(receipt.modelRuntimeBinding.scriptSha256,
    digest(await readFile(path.join(f.root, "config/hermes-runtime.py"))));
  assert.equal(receipt.modelRuntimeBinding.manifestSha256,
    digest(await readFile(path.join(f.root, "config/hermes-models.json"))));
  assert.equal(receipt.controllerSha256, digest(await readFile(path.join(f.root, "controller.py"))));
  assert.deepEqual(await readFile(path.join(f.root, "config/hermes-runtime.py")), await readFile("scripts/setup/hermes-runtime.py"));
  assert.ok(f.calls.includes("local-start"));
});

test("runtime binding refuses a running Hermes process before overwriting files or starting a job", async (t) => {
  const f = await fixture(t, true);
  await assert.rejects(f.manager.setupLocal(f.plan), { code: "stop_hermes_before_runtime_upgrade" });
  assert.equal(await readFile(path.join(f.root, "controller.py"), "utf8"), "original-controller");
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "receipt.json"))), f.receipt);
  assert.deepEqual(f.calls, []);
});
