import { test } from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceController, canonical } from "../../src/lib/workspace-controller.mjs";
const origin = "http://127.0.0.1:4208";
const req = (headers = {}) => new Request(origin + "/api/workspace", { headers: { host: "127.0.0.1:4208", ...headers } });
const draft = { schema: "process.draft.v1", process_id: "demo", inputs: {}, steps: [{ step_id: "step-1", depends_on: [], capabilities: [], resources: [], inputs: {}, bindings: {}, outputs: {}, max_attempts: 1 }] };
const command = { schema: "runtime.command.v1", operation: "process.draft.put", request_id: "request-1", resource: "processes/demo", expected_version: null, payload: { draft, provenance: { source_id: "source-1", media_type: "application/json", content_hash: "a".repeat(64), parser: "explicit-json-v1", uncertainties: [] } } };
async function fixture(t, override = {}) {
    const base = await mkdtemp(path.join(os.tmpdir(), "zenith-workspace-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const root = path.join(base, "Process-Workspace");
    await mkdir(root);
    const calls = [];
    let now = 100;
    const env = { ZENITH_LOCAL_OPERATOR: "1", ZENITH_PROCESS_PROFILE: "workspace", ZENITH_PROCESS_ROOT: root };
    const run = async (exe, args, options) => { calls.push({ exe, args, options }); return { stdout: JSON.stringify(args[4] === "workspace-status" ? { installed: true, workspace: { setup: "configured", configuration_digest: "b".repeat(64) }, components: { runtime: { live: true, ready: true, managed: true } } } : { schema: "runtime.result.v1", operation: "process.draft.put", request_id: "request-1", duplicate: false, resource: "processes/demo", version: 1, result: { process_id: "demo", version: 1, revision: 1, draft }, secret: "NEVER_PROJECT" }) }; };
    const c = createWorkspaceController({ env, platform: "darwin", arch: "arm64", run, clock: () => now, ...override });
    const state = await c.get(req());
    const post = (body, headers = {}) => c.post(req({ origin, "content-type": "application/json", "x-zenith-csrf": state.csrf, ...headers }), { schema: "zenith.workspace-action.v1", ...body });
    return { c, post, calls, root, advance: () => { now += 60001; } };
}
test("workspace is opt-in and numeric loopback only", async () => {
    for (const options of [{ env: {} }, { env: { ZENITH_LOCAL_OPERATOR: "1", ZENITH_PROCESS_PROFILE: "installation" } }, { env: { ZENITH_LOCAL_OPERATOR: "1", ZENITH_PROCESS_PROFILE: "workspace" }, platform: "linux" }]) {
        const c = createWorkspaceController({ ...options, run: () => assert.fail("executed") });
        assert.equal((await c.get(req())).mode, "disabled");
        await assert.rejects(c.post(req(), {}), { code: "workspace_disabled" });
    }
});
test("workspace requires same origin CSRF and a closed action before child execution", async (t) => {
    const f = await fixture(t);
    const before = f.calls.length;
    for (const headers of [{ origin: "https://evil.example" }, { host: "evil.example" }, { "x-zenith-csrf": "wrong" }, { "sec-fetch-site": "cross-site" }])
        await assert.rejects(f.post({ operation: "plan", action: "draft-put", payload: command }, headers));
    for (const action of [{ operation: "plan", action: "run.create", payload: {} }, { operation: "plan", action: "draft-put", payload: command, root: "/tmp/other" }, { operation: "plan", action: "draft-put", payload: { ...command, resource: "processes/other" } }, { operation: "plan", action: "publish", payload: { ...command, operation: "process.publish", expected_version: null } }])
        await assert.rejects(f.post(action));
    assert.equal(f.calls.length, before);
});
test("review fixes payload digest/version and apply is idempotent", async (t) => {
    const f = await fixture(t);
    const input = structuredClone(command);
    const { plan } = await f.post({ operation: "plan", action: "draft-put", payload: input });
    assert.match(plan.payload_sha256, /^[a-f0-9]{64}$/);
    assert.equal(plan.expected_version, null);
    input.payload.draft.process_id = "mutated";
    const a = await f.post({ operation: "apply", plan_id: plan.id });
    const b = await f.post({ operation: "apply", plan_id: plan.id });
    assert.deepEqual(a, b);
    const calls = f.calls.filter(x => x.args[4] === "workspace-command");
    assert.equal(calls.length, 1);
    const bytes = calls[0].options.input;
    assert.ok(calls[0].args.includes("--request-stdin"));
    assert.ok(!calls[0].args.includes("--request-json"));
    assert.equal(JSON.parse(bytes).payload.payload.draft.process_id, "demo");
    assert.equal(calls[0].options.shell, false);
    assert.ok(!JSON.stringify(a).includes("NEVER_PROJECT"));
});
test("changed configuration and expired review cannot dispatch", async (t) => {
    const f = await fixture(t);
    const { plan } = await f.post({ operation: "plan", action: "draft-put", payload: command });
    f.advance();
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "plan_changed_or_expired" });
    assert.equal(f.calls.filter(x => x.args[4] === "workspace-command").length, 0);
});
test("all command payloads and nesting are bounded", async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.post({ operation: "plan", action: "validate", payload: { ...draft, title: "x".repeat(65536) } }), { code: "request_too_large" });
    let nested = {};
    for (let i = 0; i < 40; i++)
        nested = { x: nested };
    assert.throws(() => canonical(nested), { code: "invalid_payload" });
});
test("concurrent apply is single-flight and retains exact result", async (t) => {
    let unblock, entered;
    const start = new Promise(r => entered = r);
    let count = 0;
    const f = await fixture(t, { run: async (exe, args) => { if (args[4] === "workspace-status")
            return { stdout: JSON.stringify({ installed: true, workspace: { setup: "configured", configuration_digest: "b".repeat(64) }, components: { runtime: { live: true, ready: true, managed: true } } }) }; count++; entered(); await new Promise(r => unblock = r); return { stdout: JSON.stringify({ schema: "frank.workspace.validation.v1", valid: true, compilation_hash: "c".repeat(64) }) }; } });
    const { plan } = await f.post({ operation: "plan", action: "validate", payload: draft });
    const pending = f.post({ operation: "apply", plan_id: plan.id });
    await start;
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "operation_in_progress" });
    unblock();
    await pending;
    await f.post({ operation: "apply", plan_id: plan.id });
    assert.equal(count, 1);
});
test("configuration changes invalidate the reviewed command", async (t) => {
    const f = await fixture(t);
    const { plan } = await f.post({ operation: "plan", action: "draft-put", payload: command });
    await mkdir(path.join(f.root, "config"));
    await writeFile(path.join(f.root, "config/workspace-setup-plan.json"), "{}", { mode: 0o600 });
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "plan_changed_or_expired" });
    assert.equal(f.calls.filter(c => c.args[4] === "workspace-command").length, 0);
});
test("controller retains action and request even if input mutates during status await", async (t) => {
    const input = { operation: "plan", action: "draft-put", payload: structuredClone(command) };
    const f = await fixture(t, { run: async (exe, args) => { if (args[4] === "workspace-status") {
            input.action = "workspace-stop";
            input.payload.resource = "processes/changed";
            return { stdout: JSON.stringify({ installed: true, workspace: { setup: "configured" }, components: { runtime: { managed: true } } }) };
        } return { stdout: JSON.stringify({ schema: "runtime.result.v1", operation: "process.draft.put", request_id: "request-1", resource: "processes/demo", duplicate: false, version: 1, result: {} }) }; } });
    input.action = "draft-put";
    input.payload = structuredClone(command);
    const { plan } = await f.post(input);
    assert.equal(plan.action, "draft-put");
    assert.equal(plan.payload.resource, "processes/demo");
    await f.post({ operation: "apply", plan_id: plan.id });
});
test("a mismatched Runtime result is never marked as the reviewed command", async (t) => {
    const f = await fixture(t, { run: async (exe, args) => ({ stdout: JSON.stringify(args[4] === "workspace-status" ? { installed: true, workspace: { setup: "configured" }, components: {} } : { schema: "runtime.result.v1", request_id: "another-command", operation: "process.draft.put", resource: "processes/demo", version: 1, result: {} }) }) });
    const { plan } = await f.post({ operation: "plan", action: "draft-put", payload: command });
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "workspace_result_binding_changed" });
});
test("newlines in identifiers reject before a native call", async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.post({ operation: "plan", action: "get", payload: { process_id: "demo\n" } }), { code: "invalid_payload" });
});
test("setup review displays and pins the same public finite-window plan", async (t) => {
    const calls = [];
    const f = await fixture(t, { run: async (exe, args) => { calls.push(args); return { stdout: JSON.stringify(args[4] === "workspace-status" ? { installed: true, workspace: { setup: "absent" }, components: {} } : { ok: true }) }; } });
    await mkdir(path.join(f.root, "config"));
    await writeFile(path.join(f.root, "config/workspace-setup-plan.json"), JSON.stringify({ schema: "castalia.wallet-workspace-setup.v1", workspace_root: f.root, not_before: "100", not_after: "3600", identity_not_after: "31536100", wallet_command_sha256: "a".repeat(64), verifier_sha256: "b".repeat(64) }), { mode: 0o600 });
    const { plan } = await f.post({ operation: "plan", action: "workspace-setup", payload: {} });
    assert.equal(plan.setup.not_after, "3600");
    assert.equal(plan.setup.identity_not_after, "31536100");
    assert.match(plan.setup.scope, /No run execution/);
    await f.post({ operation: "apply", plan_id: plan.id });
    const dispatched = calls.find(a => a[4] === "workspace-setup");
    const bytes = await readFile(path.join(f.root, "config/workspace-setup-plan.json"));
    assert.equal(dispatched[dispatched.indexOf("--selection-sha256") + 1], createHash("sha256").update(bytes).digest("hex"));
});
test("prepare is public-proposal only, create-only and CAS-pins an existing plan", async (t) => {
    const calls = [];
    const f = await fixture(t, { run: async (exe, args) => { calls.push(args); return { stdout: JSON.stringify(args[4] === "workspace-status" ? { installed: true, workspace: { setup: "not_selected" }, components: {} } : { prepared: true }) }; } });
    const first = await f.post({ operation: "plan", action: "workspace-prepare", payload: {} });
    await f.post({ operation: "apply", plan_id: first.plan.id });
    assert.ok(!calls.find(a => a[4] === "workspace-prepare").includes("--request-json"));
    await mkdir(path.join(f.root,"config"));
    await writeFile(path.join(f.root,"config/workspace-setup-plan.json"),"{}",{mode:0o600});
    const second=await f.post({operation:"plan",action:"workspace-prepare",payload:{}});
    await f.post({operation:"apply",plan_id:second.plan.id});
    const prepared=calls.filter(a=>a[4]==="workspace-prepare");
    assert.equal(prepared.length,2);
    assert.match(prepared[1][prepared[1].indexOf("--selection-sha256")+1],/^[a-f0-9]{64}$/);
});

test("retained cleanup marker blocks commands even if a stale status omits it",async(t)=>{
 const f=await fixture(t);await mkdir(path.join(f.root,"logs"));await writeFile(path.join(f.root,"logs/workspace-operation.json"),"{}",{mode:0o600});await assert.rejects(f.post({operation:"plan",action:"draft-put",payload:command}),{code:"workspace_action_unavailable"});assert.equal(f.calls.filter(c=>c.args[4]==="workspace-command").length,0);
});

test("private process literal is only in stdin and its exact digest remains in argv",async(t)=>{
 const f=await fixture(t);const payload=structuredClone(command),literal="PRIVATE-PROCESS-LITERAL-8ed6fb3a";payload.payload.draft.title=literal;const {plan}=await f.post({operation:"plan",action:"draft-put",payload});await f.post({operation:"apply",plan_id:plan.id});const call=f.calls.find(c=>c.args[4]==="workspace-command");assert.ok(call.options.input.includes(literal));assert.ok(!call.args.some(arg=>arg.includes(literal)));assert.ok(call.args.includes("--request-stdin"));assert.ok(!call.args.includes("--request-json"));const digest=createHash("sha256").update(call.options.input).digest("hex");assert.equal(digest,plan.payload_sha256);assert.equal(call.args[call.args.indexOf("--request-sha256")+1],digest);
});


test("setup preview rejects malformed or inconsistent identity lifetimes before setup", async (t) => {
    const f = await fixture(t, { run: async () => ({ stdout: JSON.stringify({ installed: true, workspace: { setup: "absent" }, components: {} }) }) });
    await mkdir(path.join(f.root, "config"));
    const valid = { schema: "castalia.wallet-workspace-setup.v1", workspace_root: f.root, not_before: "100", not_after: "3700", identity_not_after: "31536100", wallet_command_sha256: "a".repeat(64), verifier_sha256: "b".repeat(64) };
    for (const patch of [{ identity_not_after: undefined }, { identity_not_after: 31536100 }, { identity_not_after: "031536100" }, { identity_not_after: "31536100\n" }, { identity_not_after: "Infinity" }, { identity_not_after: "9007199254740992" }, { identity_not_after: "3699" }, { identity_not_after: "31536101" }, { not_before: "0100" }, { not_after: "3701" }, { unexpected: true }, { verifier_sha256: "not-a-pin" }]) {
        await writeFile(path.join(f.root, "config/workspace-setup-plan.json"), JSON.stringify({ ...valid, ...patch }), { mode: 0o600 });
        const snapshot = await f.c.get(req());
        assert.ok(!snapshot.actions.includes("workspace-setup"), JSON.stringify(patch));
        await assert.rejects(f.post({ operation: "plan", action: "workspace-setup", payload: {} }), { code: "workspace_action_unavailable" });
    }
});

test("changing only the machine identity expiry invalidates the reviewed setup", async (t) => {
    const calls = [];
    const f = await fixture(t, { run: async (exe, args) => { calls.push(args); return { stdout: JSON.stringify({ installed: true, workspace: { setup: "absent" }, components: {} }) }; } });
    await mkdir(path.join(f.root, "config"));
    const setup = { schema: "castalia.wallet-workspace-setup.v1", workspace_root: f.root, not_before: "100", not_after: "3700", identity_not_after: "31536100", wallet_command_sha256: "a".repeat(64), verifier_sha256: "b".repeat(64) };
    await writeFile(path.join(f.root, "config/workspace-setup-plan.json"), JSON.stringify(setup), { mode: 0o600 });
    const { plan } = await f.post({ operation: "plan", action: "workspace-setup", payload: {} });
    await writeFile(path.join(f.root, "config/workspace-setup-plan.json"), JSON.stringify({ ...setup, identity_not_after: "31536099" }), { mode: 0o600 });
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), { code: "plan_changed_or_expired" });
    assert.equal(calls.filter(a => a[4] === "workspace-setup").length, 0);
});
