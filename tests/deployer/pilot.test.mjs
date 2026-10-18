import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createController } from "../../src/lib/pilot-controller.mjs";
const origin = "http://127.0.0.1:4208";
const request = (headers = {}, method = "GET") => new Request(origin + "/api/deployer", {
  method, headers: { host: "127.0.0.1:4208", ...headers },
});
async function fixture(t, { profile = "local-review", cleanup = false } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "zenith-pilot-controller-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "Process-Pilot");
  await mkdir(root, { mode: 0o700 });
  for (const name of ["config", "data", "authority", "authority/config"])
    await mkdir(path.join(root, name), { mode: 0o700 });
  const selected = JSON.stringify({ schema: "hub.process-macos-pilot.v1", setup_plan_sha256: "a".repeat(64), workflow_sha256: "b".repeat(64) });
  await writeFile(path.join(root, "config/pilot-controller.json"), selected, { mode: 0o600 });
  await writeFile(path.join(root, "config/pilot-setup-plan.json"), "{}", { mode: 0o600 });
  await writeFile(path.join(root, "config/pilot-workflow.json"), "{}", { mode: 0o600 });
  if (cleanup) await writeFile(path.join(root, "data/pilot-operation.json"), "{}", { mode: 0o600 });
  const env = { ZENITH_LOCAL_OPERATOR: "1", ZENITH_PROCESS_PROFILE: profile, ZENITH_PROCESS_ROOT: root };
  const calls = [];
  let now = 100;
  let setup = "configured";
  let workflow = { run_state: "running", observed_at: 10, recoverable: true, export_available: true };
  const run = async (exe, args, options) => {
    calls.push({ exe, args, options });
    return { stdout: JSON.stringify({ installed: true, authority: "pending", pilot_ready: false, external_effects: false,
      frank: { actor_count: 0 }, components: { runtime: { live: true, ready: false, managed: true }, service: { live: true, ready: false, managed: true } },
      pilot: { setup, cleanup_unresolved: cleanup, workflow_selected: true, workflow }, seed: "DO_NOT_PROJECT", raw_output: "DO_NOT_PROJECT" }) };
  };
  const c = createController({ env, platform: "darwin", arch: "arm64", run, clock: () => now });
  const snapshot = await c.get(request());
  const post = body => c.post(request({ origin, "content-type": "application/json", "x-zenith-csrf": snapshot.csrf }, "POST"),
    { schema: "zenith.deployer-action.v1", ...body });
  return { c, env, run, post, root, calls, selected,
    expire: () => { now += 60000; }, setup: value => { setup = value; }, workflow: value => { workflow = value; } };
}
test("local-review profile projects bounded facts and keeps production ready false", async t => {
  const f = await fixture(t); const value = await f.c.get(request());
  assert.equal(value.profile, "local-review-v1");
  assert.equal(value.status.pilot_ready, false);
  assert.equal(value.status.external_effects, false);
  assert.equal(value.status.pilot.setup, "configured");
  assert.equal(value.status.pilot.workflow.run_state, "running");
  assert.equal(JSON.stringify(value).includes("DO_NOT_PROJECT"), false);
  assert.ok(value.actions.includes("pilot-next"));
  assert.ok(value.actions.includes("pilot-export"));
});
test("default installation profile never admits pilot actions", async t => {
  const f = await fixture(t, { profile: "installation" });
  await assert.rejects(f.post({ operation: "plan", action: "pilot-setup" }), { code: "invalid_action" });
  assert.ok(!f.calls.some(call => call.args[4].startsWith("pilot-")));
});
test("reviewed action binds selection hash and fixed arguments, never browser input", async t => {
  const f = await fixture(t);
  const { plan } = await f.post({ operation: "plan", action: "pilot-next" });
  await f.post({ operation: "apply", plan_id: plan.id });
  const [call] = f.calls.filter(call => call.args[4] === "pilot-next");
  assert.deepEqual(call.args.slice(0, 3), ["-I", "-S", "-B"]);
  assert.deepEqual(call.args.slice(4), ["pilot-next", "--root", f.root, "--selection-sha256",
    createHash("sha256").update(f.selected).digest("hex")]);
  assert.equal(call.options.shell, false);
  assert.ok(call.options.timeout > 110000);
  await assert.rejects(f.post({ operation: "plan", action: "pilot-next", argv: ["sh"] }));
  await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "unknown_plan" });
});
test("all fixed public configuration bytes are included in plan CAS", async t => {
  for (const name of ["config/pilot-controller.json", "config/pilot-workflow.json", "authority/config/wallet-command.json"]) {
    const f = await fixture(t);
    const { plan } = await f.post({ operation: "plan", action: "pilot-next" });
    await writeFile(path.join(f.root, name), "changed", { mode: 0o600 });
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "plan_changed_or_expired" });
    assert.ok(!f.calls.some(call => call.args[4] === "pilot-next"));
  }
});
test("pilot expiry is checked after asynchronous configuration and status reads", async t => {
  const f = await fixture(t);
  const { plan } = await f.post({ operation: "plan", action: "pilot-next" });
  const pending = f.post({ operation: "apply", plan_id: plan.id }); f.expire();
  await assert.rejects(pending, { code: "plan_changed_or_expired" });
  assert.ok(!f.calls.some(call => call.args[4] === "pilot-next"));
});
test("persisted unresolved operation blocks a new controller without signalling old identifiers", async t => {
  const f = await fixture(t, { cleanup: true });
  const first = await f.c.get(request());
  assert.deepEqual(first.actions, ["doctor", "stop"]);
  await assert.rejects(f.post({ operation: "plan", action: "pilot-next" }), { code: "pilot_action_unavailable" });
  const restarted = createController({ env: f.env, platform: "darwin", arch: "arm64", run: f.run });
  assert.deepEqual((await restarted.get(request())).actions, ["doctor", "stop"]);
  assert.ok(!f.calls.some(call => call.args[4].startsWith("pilot-")));
});
test("partial setup has no recreate, start, or worker action", async t => {
  const f = await fixture(t); f.setup("partial");
  assert.deepEqual((await f.c.get(request())).actions, ["doctor", "stop"]);
  for (const action of ["pilot-setup", "start", "pilot-next"])
    await assert.rejects(f.post({ operation: "plan", action }), { code: "pilot_action_unavailable" });
});
test("unsafe fixed configuration file is not followed", async t => {
  const f = await fixture(t);
  const selected = path.join(f.root, "config/pilot-controller.json");
  const other = path.join(f.root, "config/other.json");
  await writeFile(other, f.selected, { mode: 0o600 }); await rm(selected); await symlink(other, selected);
  assert.deepEqual((await f.c.get(request())).actions, ["doctor", "stop"]);
  await assert.rejects(f.post({operation:"plan",action:"pilot-next"}), {code:"pilot_action_unavailable"});
  assert.ok(!f.calls.some(call => call.args[4].startsWith("pilot-")));
});
