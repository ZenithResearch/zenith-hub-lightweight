import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  writeFile,
  mkdir,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadCatalog, resolveSelection, digest } from "../../src/lib/setup/catalog.mjs";
import { createSetupController } from "../../src/lib/setup/controller.mjs";
import {
  endpoint,
  publicAddress,
  requestJSON,
  probe,
} from "../../src/lib/setup/network.mjs";
import { stateStore } from "../../src/lib/setup/state.mjs";
import { adapters } from "../../src/lib/setup/adapters.mjs";
const registry = await loadCatalog(),
  origin = "http://127.0.0.1:4308";
async function fixture(t, adapter = {}, options = {}) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "hub-setup-test-")),
  );
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const c = createSetupController({
    registry,
    env: {
      ZENITH_LOCAL_OPERATOR: "1",
      ZENITH_GUIDED_SETUP: "1",
      ZENITH_OPERATOR_ORIGIN: origin,
      ZENITH_HUB_SETUP_DIR: root,
    },
    projector: async () => {},
    ...options,
    adapterFactory: () => ({
      prepare: async () => ({
        artifacts: [],
        prerequisites: [],
        effects: ["test"],
      }),
      install: async (p) => calls.push(["install", p.instanceId]),
      configure: async (p) => calls.push(["configure", p.instanceId]),
      start: async (p) => calls.push(["start", p.instanceId]),
      stop: async (p) => calls.push(["stop", p.instanceId]),
      observe: async () => ({
        observedAt: new Date().toISOString(),
        reachable: true,
        applicationReady: false,
      }),
      status: async () => false,
      ...adapter,
    }),
  });
  const req = (csrf, overrides = {}) =>
    new Request(origin + "/api/setup", {
      headers: {
        host: "127.0.0.1:4308",
        origin,
        "content-type": "application/json",
        ...(csrf ? { "x-zenith-csrf": csrf } : {}),
        ...overrides,
      },
    });
  const session = await c.get(req());
  const post = (body) =>
    c.post(req(session.csrf), {
      schema: "zenith.hub-setup-action.v1",
      ...body,
    });
  return { c, root, calls, post, req, session };
}
const runtime = {
  instanceId: "runtime-example",
  componentId: "process-runtime",
  mode: "install",
  config: { port: 19292 },
};
test("catalog resolves a selected package closure without selecting or starting other services", () => {
  const r = resolveSelection(registry, [
    {
      instanceId: "frank-only",
      componentId: "frank",
      mode: "install",
      config: {},
    },
  ]);
  assert.equal(r.length, 1);
  const files = r[0].descriptor.artifacts.flatMap((a) => a.files);
  assert.ok(files.some((n) => n.startsWith("process_runtime-")));
  assert.ok(!files.some((n) => n.startsWith("service_management-")));
  assert.equal(
    resolveSelection(registry, [runtime])[0].serviceRequirements.length,
    0,
  );
});
test("Matrix review requires an explicit identity and distinguishes private federation", () => {
  const m = {
    instanceId: "matrix-test",
    componentId: "matrix",
    mode: "install",
    config: {
      port: 19208,
      serverName: "test.example.org",
      access: "private",
      identityAcknowledged: false,
    },
  };
  assert.throws(() => resolveSelection(registry, [m]), {
    code: "matrix_identity_review_required",
  });
  m.config.identityAcknowledged = true;
  assert.equal(resolveSelection(registry, [m]).length, 1);
  m.config.federation = true;
  assert.throws(() => resolveSelection(registry, [m]), {
    code: "private_federation_conflict",
  });
  assert.equal(
    resolveSelection(registry, [{ ...m, config: {} }], { review: false })
      .length,
    1,
  );
});
test("selection rejects duplicate IDs and ports, arbitrary paths, unknown config and modes", () => {
  assert.throws(() => resolveSelection(registry, [runtime, runtime]));
  assert.throws(
    () =>
      resolveSelection(registry, [
        runtime,
        { ...runtime, instanceId: "another" },
      ]),
    { code: "selected_port_collision" },
  );
  assert.throws(() =>
    resolveSelection(registry, [
      { ...runtime, config: { port: 19292, command: "rm" } },
    ]),
  );
  assert.throws(() =>
    resolveSelection(registry, [{ ...runtime, instanceId: "../data" }]),
  );
});
test("review apply persists a receipt selection, is replay-safe, and never starts a selected component implicitly", async (t) => {
  const f = await fixture(t);
  const v = await f.post({
    operation: "plan",
    action: "install",
    selection: [runtime],
    expectedRevision: 0,
  });
  assert.equal(f.calls.length, 0);
  const result = await f.post({ operation: "apply", planId: v.plan.id });
  assert.deepEqual(f.calls, [["install", "runtime-example"]]);
  assert.equal(result.instances.length, 1);
  assert.equal(
    (await f.post({ operation: "apply", planId: v.plan.id })).replayed,
    true,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(
    (await stateStore(f.root).read()).operations[v.plan.id].state,
    "complete",
  );
});
test("stale or cancelled review and mismatched origin reject without effects", async (t) => {
  const f = await fixture(t);
  const p = await f.post({
    operation: "plan",
    action: "install",
    selection: [runtime],
    expectedRevision: 0,
  });
  await f.post({
    operation: "save",
    step: "components",
    selection: [runtime],
    expectedRevision: 0,
  });
  await assert.rejects(f.post({ operation: "apply", planId: p.plan.id }), {
    code: "setup_plan_changed",
  });
  const q = await f.post({
    operation: "plan",
    action: "install",
    selection: [runtime],
    expectedRevision: 1,
  });
  await f.post({ operation: "cancel", planId: q.plan.id });
  await assert.rejects(f.post({ operation: "apply", planId: q.plan.id }), {
    code: "setup_plan_expired",
  });
  assert.throws(
    () =>
      f.c.admitMutation(
        f.req(f.session.csrf, { origin: "https://invalid.example" }),
      ),
    { code: "wrong_origin" },
  );
  assert.equal(f.calls.length, 0);
});
test("external services remain connections without process-control adoption", async (t) => {
  const f = await fixture(t),
    selection = [
      {
        instanceId: "existing-hermes",
        componentId: "hermes",
        mode: "connect",
        config: { endpoint: "http://127.0.0.1:8642" },
      },
    ];
  const p = await f.post({
    operation: "plan",
    action: "connect",
    selection,
    expectedRevision: 0,
  });
  const s = await f.post({ operation: "apply", planId: p.plan.id });
  assert.equal(s.instances[0].mode, "connect");
  assert.equal(s.instances[0].installed, null);
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    f.post({
      operation: "plan",
      action: "stop",
      instanceId: "existing-hermes",
      expectedRevision: s.revision,
    }),
    { code: "external_resource_not_managed" },
  );
});
test("partial failure retains an explicit reconciliation state and never overwrites its data", async (t) => {
  const f = await fixture(t, {
    install: async () => {
      throw Error("failure");
    },
  });
  const p = await f.post({
    operation: "plan",
    action: "install",
    selection: [runtime],
    expectedRevision: 0,
  });
  await assert.rejects(f.post({ operation: "apply", planId: p.plan.id }));
  const s = await stateStore(f.root).read();
  assert.equal(s.operations[p.plan.id].state, "reconciliation-required");
  assert.equal(s.instances.length, 1);
  assert.equal(s.instances[0].installed, false);
  assert.equal(s.instances[0].partial, true);
});
test("remote endpoints reject credentials, redirects by construction, unsafe schemes and private DNS before a request", async () => {
  for (const u of [
    "http://example.com",
    "https://a:b@example.com",
    "https://example.com/path",
    "https://example.com?key=x",
    "http://localhost:8642",
  ])
    assert.throws(() => endpoint(u));
  assert.equal(publicAddress("127.0.0.1"), false);
  assert.equal(publicAddress("169.254.169.254"), false);
  assert.equal(publicAddress("100.64.1.1"), false);
  assert.equal(publicAddress("::ffff:127.0.0.1"), false);
  await assert.rejects(
    requestJSON("https://example.org", "/health", {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    { code: "private_remote_endpoint" },
  );
});
test("optional setup is disabled without opening a data directory", async () => {
  const c = createSetupController({ env: {}, registry });
  assert.equal((await c.get(new Request(origin))).mode, "disabled");
});

test("read-only background health checks preserve a valid review and state revision", async (t) => {
  const f = await fixture(t);
  const p = await f.post({
    operation: "plan",
    action: "install",
    selection: [runtime],
    expectedRevision: 0,
  });
  for (let n = 0; n < 3; n++) {
    const s = await f.c.get(f.req());
    assert.equal(s.revision, 0);
  }
  await f.post({ operation: "apply", planId: p.plan.id });
  assert.equal(f.calls.length, 1);
});
test("background installation exposes durable pending state and survives observer refreshes", async (t) => {
  let work;
  const f = await fixture(
    t,
    {},
    {
      defer: (fn) => {
        work = fn;
      },
    },
  );
  const p = await f.post({
    operation: "plan",
    action: "install",
    selection: [runtime],
    expectedRevision: 0,
  });
  const accepted = await f.post({
    operation: "apply",
    planId: p.plan.id,
    background: true,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.busy, true);
  assert.equal(f.calls.length, 0);
  const during = await f.c.get(f.req());
  assert.equal(during.operations[0].state, "applying");
  assert.equal(during.instances[0].partial, true);
  await assert.rejects(
    f.post({
      operation: "save",
      step: "welcome",
      selection: [],
      expectedRevision: during.revision,
    }),
    { code: "setup_busy" },
  );
  await work();
  const done = await f.c.get(f.req());
  assert.equal(done.busy, false);
  assert.equal(done.operations[0].state, "complete");
  assert.equal(done.instances[0].partial, false);
});
test("Hermes missing installer Python is an actionable preflight failure, not an apply-time surprise", async (t) => {
  const { adapters } = await import("../../src/lib/setup/adapters.mjs");
  const f = await fixture(t);
  let calls = 0;
  const a = adapters({
    root: f.root,
    env: { ZENITH_SETUP_PYTHON: "/definitely-absent/hub-python" },
    run: async () => {
      calls++;
      throw Error("must not execute");
    },
  });
  const item = resolveSelection(registry, [
    {
      componentId: "hermes",
      instanceId: "new-hermes",
      mode: "install",
      config: { port: 19442 },
    },
  ])[0];
  const p = await a.prepare(item);
  assert.equal(p.bootstrap, null);
  assert.ok(p.prerequisites.some((v) => v.includes("Install Python 3.12")));
  assert.equal(calls, 0);
});
test("empty Matrix cache offers reviewed preparation and does not fetch while reviewing", async (t) => {
  const { adapters } = await import("../../src/lib/setup/adapters.mjs");
  const f = await fixture(t);
  let calls = 0;
  const a = adapters({
    root: f.root,
    env: { ZENITH_SETUP_PYTHON: "/definitely-absent/hub-python" },
    run: async () => {
      calls++;
      throw Error("unavailable");
    },
  });
  const item = resolveSelection(registry, [
    {
      componentId: "matrix",
      instanceId: "matrix-empty",
      mode: "install",
      config: {
        port: 19408,
        serverName: "disposable.invalid",
        identityAcknowledged: true,
        access: "private",
      },
    },
  ])[0];
  const p = await a.prepare(item);
  assert.equal(p.preparation.ready, false);
  assert.ok(
    p.prerequisites.some((v) =>
      v.includes("Review Matrix artifact preparation"),
    ),
  );
  await assert.rejects(readFile(path.join(f.root, "cache/matrix")));
  assert.equal(calls, 0);
});
test("draft navigation keeps incomplete Matrix identity and empty optional fields without weakening review", async () => {
  const draft = {
    componentId: "matrix",
    instanceId: "matrix-draft",
    mode: "install",
    config: { serverName: "", identityAcknowledged: false, secretRef: "" },
  };
  assert.equal(
    resolveSelection(registry, [draft], { review: false }).length,
    1,
  );
  assert.throws(() => resolveSelection(registry, [draft]));
});


test("repeated process status checks are read-only and do not reserve operation logs", async (t) => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "hub-status-read-")));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "not-created");
  let checks = 0;
  const adapter = adapters({
    root,
    run: async (_executable, args, options) => {
      assert.equal(args[3], "status");
      if (options.logFile) {
        await mkdir(path.dirname(options.logFile), { recursive: true });
        await writeFile(options.logFile, "status", { flag: "wx" });
      }
      checks++;
      return JSON.stringify({ running: checks > 1 });
    },
  });
  const item = { mode: "install", planFile: path.join(parent, "instance-plan.json") };
  assert.equal(await adapter.status(item), false);
  assert.equal(await adapter.status(item), true);
  await assert.rejects(readFile(path.join(root, "logs", "instance-plan.json.status.log")), { code: "ENOENT" });
});

const managedHermes = { instanceId: "hermes-model-test", componentId: "hermes", mode: "install", config: { port: 19499, backendKind: "local", modelEndpoint: "http://127.0.0.1:19343", modelName: "legacy-model", contextLength: 65536, secretRef: "old-server" } };
async function seedManagedHermes(f) {
  const root = path.join(f.root, "instances", managedHermes.instanceId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "receipt.json"), JSON.stringify({ componentId: "hermes", installed: true, configured: true }), { mode: 0o600 });
  await stateStore(f.root).write((s) => { s.instances.push({ ...structuredClone(managedHermes), root, installed: true, configured: true, running: false }); });
}
test("native provider selections preserve legacy records and discard stale custom-server fields", () => {
  assert.deepEqual(resolveSelection(registry, [managedHermes])[0].config, managedHermes.config);
  const native = resolveSelection(registry, [{ ...managedHermes, config: { ...managedHermes.config, providerId: "anthropic", localModelId: "qwen35-4b" } }])[0].config;
  assert.equal(native.modelName, "legacy-model");
  assert.equal(native.providerId, "anthropic");
  for (const key of ["modelEndpoint", "secretRef", "contextLength", "localModelId"]) assert.equal(key in native, false, key);
  assert.throws(() => resolveSelection(registry, [{ ...managedHermes, config: { ...managedHermes.config, apiKey: "never-in-state" } }]), { code: "invalid_component_configuration" });
});
test("provider credentials pass only to Hermes and invalidate earlier reviews without entering Hub state", async (t) => {
  const privateKey = "fixture-only-provider-key";
  let forwarded;
  const f = await fixture(t, { modelRequest: async (_i, request) => { forwarded = request; return { credentialConfigured: true }; } });
  await seedManagedHermes(f);
  const snapshot = await f.c.get(f.req());
  const planned = await f.post({ operation: "plan", action: "configure-backend", instanceId: managedHermes.instanceId, backend: { providerId: "gemini", modelName: "fixture-model" }, expectedRevision: snapshot.revision });
  const response = await f.post({ operation: "hermes-model", instanceId: managedHermes.instanceId, modelRequest: { action: "connect-key", providerId: "gemini", apiKey: privateKey } });
  assert.equal(forwarded.apiKey, privateKey);
  assert.equal(JSON.stringify(response).includes(privateKey), false);
  assert.equal(JSON.stringify(await stateStore(f.root).read()).includes(privateKey), false);
  await assert.rejects(f.post({ operation: "apply", planId: planned.plan.id }), { code: "setup_plan_changed" });
});
test("OAuth approval invalidates reviews exactly once and keeps tokens out of Hub records", async (t) => {
  const f = await fixture(t, { modelRequest: async () => ({ session_id: "fixture-session", status: "approved" }) });
  await seedManagedHermes(f);
  const action = { operation: "hermes-model", instanceId: managedHermes.instanceId, modelRequest: { action: "oauth-poll", providerId: "openai-codex", sessionId: "fixture-session" } };
  const first = await f.post(action), second = await f.post(action);
  assert.equal(first.revision, second.revision);
  assert.equal(first.instances[0].lastProviderSignIn, "fixture-session");
});
test("backend changes require a managed stopped Hermes instance, including local downloads", async (t) => {
  const f = await fixture(t, { status: async () => true });
  await seedManagedHermes(f);
  const snapshot = await f.c.get(f.req());
  for (const action of ["configure-backend", "setup-local-model"]) {
    await assert.rejects(f.post({ operation: "plan", action, instanceId: managedHermes.instanceId, expectedRevision: snapshot.revision, backend: { providerId: "llamacpp", localModelId: "qwen35-4b" } }), { code: "stop_instance_before_configuration" });
  }
  await assert.rejects(f.post({ operation: "plan", action: "setup-local-model", selection: [managedHermes], expectedRevision: snapshot.revision }), { code: "backend_instance_required" });
  await assert.rejects(f.post({ operation: "hermes-model", instanceId: "unknown", modelRequest: { action: "options" } }), { code: "managed_hermes_required" });
  await assert.rejects(f.post({ operation: "hermes-model", instanceId: managedHermes.instanceId, modelRequest: { action: "local-start", modelId: "qwen35-4b" } }), { code: "invalid_model_request" });
});
test("local-model prerequisites block apply and retain the selected existing backend", async (t) => {
  const f = await fixture(t, { prepare: async () => ({ artifacts: [], prerequisites: ["More model-volume space needed."], effects: ["Download only after review."] }), "setup-local-model": async () => assert.fail("must not download") });
  await seedManagedHermes(f);
  const snapshot = await f.c.get(f.req());
  const p = await f.post({ operation: "plan", action: "setup-local-model", instanceId: managedHermes.instanceId, expectedRevision: snapshot.revision, backend: { providerId: "llamacpp", localModelId: "qwen35-4b" } });
  await assert.rejects(f.post({ operation: "apply", planId: p.plan.id }), { code: "unmet_prerequisites" });
  assert.deepEqual((await stateStore(f.root).read()).instances[0].config, managedHermes.config);
});
test("completed local-model setup records the native backend without legacy server credentials", async (t) => {
  const f = await fixture(t, { "setup-local-model": async () => ({ backend: { providerId: "llamacpp", modelName: "managed-qwen", backendKind: "local", localModelId: "qwen35-4b", contextLength: 65536 } }) });
  await seedManagedHermes(f);
  const snapshot = await f.c.get(f.req());
  const p = await f.post({ operation: "plan", action: "setup-local-model", instanceId: managedHermes.instanceId, expectedRevision: snapshot.revision, backend: { providerId: "llamacpp", localModelId: "qwen35-4b" } });
  const result = await f.post({ operation: "apply", planId: p.plan.id });
  const config = result.instances[0].config;
  assert.equal(config.modelName, "managed-qwen");
  assert.equal(config.providerId, "llamacpp");
  assert.equal(config.modelEndpoint, undefined);
  assert.equal(config.secretRef, undefined);
});
test("discovery includes saved custom ports, deduplicates endpoints and remains read-only", async (t) => {
  const probes = [];
  const f = await fixture(t, {}, { discoveryProbe: async (componentId, endpoint) => { probes.push([componentId, endpoint]); return { observedAt: new Date().toISOString(), reachable: true }; } });
  await stateStore(f.root).write((s) => { s.instances.push(
    { instanceId: "hermes-custom", componentId: "hermes", mode: "install", config: { port: 19442 } },
    { instanceId: "matrix-standard", componentId: "matrix", mode: "connect", config: { endpoint: "http://127.0.0.1:8008" } },
  ); });
  const before = await stateStore(f.root).read();
  const response = await f.post({ operation: "discover" });
  assert.equal(response.candidates.find((c) => c.endpoint.endsWith(":19442")).ownership, "hub-managed");
  assert.equal(response.candidates.find((c) => c.endpoint.endsWith(":8008")).ownership, "external-registered");
  assert.equal(probes.filter(([, endpoint]) => endpoint.endsWith(":8008")).length, 1);
  assert.deepEqual(await stateStore(f.root).read(), before);
  assert.deepEqual(f.calls, []);
});

test("retained Matrix configuration reconciles to retryable only after its writer has stopped",async t=>{
 let active=false;const f=await fixture(t,{configurationActive:async()=>active,configure:async p=>{const file=path.join(p.root,"receipt.json"),receipt=JSON.parse(await readFile(file,"utf8"));receipt.configured=true;await writeFile(file,JSON.stringify(receipt),{mode:0o600});}});
 const instanceRoot=path.join(f.root,"instances/matrix-recovery"),config={serverName:"recovery.invalid",port:19408,access:"private",federation:false,domainMode:"development",identityAcknowledged:true};
 await mkdir(path.join(instanceRoot,"config"),{recursive:true,mode:0o700});
 const write=async(name,value)=>writeFile(path.join(instanceRoot,name),JSON.stringify(value),{mode:0o600});
 const wheel="matrix_synapse-1.165.0-cp312-cp312-macosx_11_0_arm64.whl",bytes="fixture wheel",controller="# fixture controller";
 await mkdir(path.join(instanceRoot,"wheels"),{recursive:true});await writeFile(path.join(instanceRoot,"wheels",wheel),bytes);
 await writeFile(path.join(instanceRoot,"controller.py"),controller,{mode:0o600});
 const entry=path.join(instanceRoot,"venv/lib/python3.12/site-packages/synapse/app/homeserver.py");await mkdir(path.dirname(entry),{recursive:true});await writeFile(entry,"# fixture entry");
 await write("receipt.json",{instanceId:"matrix-recovery",componentId:"matrix",root:instanceRoot,installed:true,configured:false,controllerSha256:digest(controller),artifacts:[{filename:wheel,sha256:digest(bytes)}]});
 await write("config/matrix-identity.json",{root:instanceRoot,instanceId:"matrix-recovery",serverName:config.serverName,configuration:config});
 const store=stateStore(f.root);await store.write(s=>{s.instances=[{instanceId:"matrix-recovery",componentId:"matrix",mode:"install",root:instanceRoot,config}];s.operations.old={id:"old",action:"configure",state:"applying",instanceIds:["matrix-recovery"]};});
 active=true;await assert.rejects(f.post({operation:"reconcile"}),{code:"matrix_configuration_still_running"});
 assert.equal((await store.read()).operations.old.state,"applying");
 active=false;await f.post({operation:"reconcile"});assert.equal((await store.read()).operations.old.state,"retryable");
 const current=await store.read(),review=await f.post({operation:"plan",action:"configure",instanceId:"matrix-recovery",expectedRevision:current.revision});await f.post({operation:"apply",planId:review.plan.id});
 const after=await store.read();assert.equal(after.operations[review.plan.id].state,"complete");assert.equal(after.operations.old.state,"complete");assert.equal(after.operations.old.completedByOperation,review.plan.id);assert.equal(after.instances[0].configured,true);
});
