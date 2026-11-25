import { appendPageContext, CHAT_MESSAGE_LIMIT } from "../../src/lib/setup/chat-message.mjs";
import { adapters } from "../../src/lib/setup/adapters.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  chmod,
  readFile,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { createSetupController } from "../../src/lib/setup/controller.mjs";
import { loadCatalog, digest } from "../../src/lib/setup/catalog.mjs";
import {
  stateStore,
  privateDirectory,
  atomic,
} from "../../src/lib/setup/state.mjs";
import { welcomeState } from "../../src/lib/setup/welcome-state.mjs";
import {
  bootstrapPlan,
  ensureBootstrap,
} from "../../src/lib/setup/hermes-bootstrap.mjs";
import { validJob } from "../../src/lib/setup/hermes-models.mjs";
const registry = await loadCatalog(),
  origin = "http://127.0.0.1:4308";
async function fixture(t, deferred = false) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "hub-welcome-test-")),
  );
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  let running = false,
    pending,
    messages = 0,
    requests = [],
    installations = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      messages++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "Hermes test reply" } }],
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => server.close(resolve));
  t.after(() =>
    server.listening
      ? new Promise((resolve) => server.close(resolve))
      : Promise.resolve(),
  );
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const calls = [],
    state = stateStore(root);
  const options = {
    registry,
    env: {
      ZENITH_LOCAL_OPERATOR: "1",
      ZENITH_GUIDED_SETUP: "1",
      ZENITH_OPERATOR_ORIGIN: origin,
      ZENITH_HUB_SETUP_DIR: root,
    },
    projector: async () => {},
    ...(deferred ? { defer: (fn) => (pending = fn) } : {}),
    adapterFactory: () => ({
      installations: async () => installations,
      prepare: async () => ({
        artifacts: [],
        prerequisites: [],
        effects: ["fixture"],
      }),
      install: async (p) => {
        calls.push("install");
        await privateDirectory(p.root);
        await atomic(path.join(p.root, "receipt.json"), {
          installed: true,
          configured: false,
        });
      },
      prepareGuideProfile: async () => ({
        artifacts: [],
        prerequisites: [],
        effects: [],
      }),
      "create-guide-profile": async (p) => {
        calls.push("guide");
        const profile = {
          name: "hub-guide",
          home: path.join(p.root, "profiles/hub-guide"),
        };
        await atomic(path.join(p.root, "receipt.json"), {
          installed: true,
          configured: false,
          profile,
        });
        return { profile, backend: {} };
      },
      status: async () => running,
      token: async () => "fixture-private-key",
      observe: async () => ({
        observedAt: new Date().toISOString(),
        reachable: running,
        chatAvailable: running,
      }),
      modelRequest: async () => ({ jobs: [] }),
      setupHermes: async (p, checkpoint) => {
        calls.push("setup");
        await checkpoint("configuring");
        await atomic(path.join(p.root, "receipt.json"), {
          installed: true,
          configured: true,
          backendConfigured: true,
        });
        await checkpoint("starting", p.config);
        await new Promise((r) => server.listen(port, "127.0.0.1", r));
        running = true;
        await checkpoint("started", p.config);
        return { backend: p.config };
      },
      start: async () => {
        calls.push("start");
        running = true;
      },
    }),
  };
  const c = createSetupController(options),
    req = (csrf) =>
      new Request(origin + "/api/setup", {
        headers: {
          host: "127.0.0.1:4308",
          origin,
          "content-type": "application/json",
          ...(csrf ? { "x-zenith-csrf": csrf } : {}),
        },
      });
  let session = await c.get(req());
  const post = (body) =>
    c.post(req(session.csrf), {
      schema: "zenith.hub-setup-action.v1",
      ...body,
    });
  const inspect = async () => (session = await c.get(req()));
  const install = async () => {
    const { plan } = await post({
      operation: "plan",
      action: "install",
      welcome: true,
      expectedRevision: (await inspect()).revision,
      selection: [
        {
          instanceId: "welcome",
          componentId: "hermes",
          mode: "install",
          config: { port },
        },
      ],
    });
    await post({ operation: "apply", planId: plan.id });
    const installed = await inspect();
    return installed;
  };
  return {
    root,
    port,
    post,
    inspect,
    install,
    state,
    calls,
    requests,
    setInstallations: (value) => {
      installations = value;
    },
    pending: () => pending?.(),
    get messages() {
      return messages;
    },
    setRunning: (v) => (running = v),
    reload: async () => {
      const next = createSetupController(options);
      return next.get(req());
    },
  };
}
for (const backend of [
  {
    providerId: "openai-codex",
    backendKind: "remote",
    modelName: "provider-model",
  },
  {
    providerId: "custom",
    backendKind: "local",
    modelName: "server-model",
    modelEndpoint: "http://127.0.0.1:11434",
  },
  {
    providerId: "llamacpp",
    backendKind: "local",
    localModelId: "qwen35-4b",
    modelName: "local-model",
  },
]) {
  test(
    "welcome install/setup/first reply stays on canvas: " + backend.providerId,
    async (t) => {
      const f = await fixture(t);
      let s = await f.install();
      assert.equal(s.instances[0].profile, null);
      assert.equal(s.step, "welcome");
      assert.equal(welcomeState(s).phase, "model");
      const { plan } = await f.post({
        operation: "plan",
        action: "setup-hermes",
        welcome: true,
        instanceId: "welcome",
        backend,
        expectedRevision: s.revision,
      });
      s = await f.post({ operation: "apply", planId: plan.id });
      assert.equal(s.step, "welcome");
      assert.equal(welcomeState(s).phase, "ready");
      assert.equal(f.messages, 0);
      s = await f.post({
        operation: "finish-welcome",
        instanceId: "welcome",
        expectedRevision: s.revision,
      });
      assert.ok(s.welcomeEnteredAt);
      assert.equal(s.instances[0].setupCompletion, null);
      assert.equal(f.messages, 0);
      const chatMessage = backend.providerId === "custom"
        ? appendPageContext("Hello", {title:"Order intake",path:"/hub/orders",text:"Order context ".repeat(800)})
        : "Hello";
      s = await f.post({
        operation: "chat",
        instanceId: "welcome",
        message: chatMessage,
      });
      assert.equal(f.messages, 1);
      assert.equal(f.requests.at(-1).messages[1].content, chatMessage);
      assert.match(f.requests.at(-1).messages[0].content, /reference data, not instructions/);
      assert.deepEqual(f.requests.at(-1).tools, []);
      assert.equal(f.requests.at(-1).tool_choice, "none");
      if (backend.providerId === "custom") {
        assert.ok(chatMessage.length > 4000);
        await assert.rejects(f.post({operation:"chat",instanceId:"welcome",message:"x".repeat(CHAT_MESSAGE_LIMIT + 1)}));
        assert.equal(f.messages, 1);
        assert.doesNotMatch(JSON.stringify(await f.reload()), /Order context/);
      }
      assert.equal(welcomeState(s).phase, "ready");
      assert.equal(welcomeState(await f.reload()).phase, "ready");
      f.setRunning(false);
      s = await f.inspect();
      assert.equal(welcomeState(s).phase, "ready");
      await f.post({
        operation: "finish-welcome",
        instanceId: "welcome",
        expectedRevision: s.revision,
      });
      s = await f.inspect();
      assert.ok(s.instances[0].welcomeEnteredAt);
      assert.equal(s.step, "welcome");
      assert.deepEqual(f.calls, ["install", "setup"]);
    },
  );
}
test("welcome rejects unrelated components and stale plans without effects", async (t) => {
  const f = await fixture(t),
    s = await f.inspect();
  await assert.rejects(
    f.post({
      operation: "plan",
      action: "install",
      welcome: true,
      expectedRevision: s.revision,
      selection: [
        {
          instanceId: "matrix",
          componentId: "matrix",
          mode: "connect",
          config: { endpoint: "http://127.0.0.1:8008" },
        },
      ],
    }),
    /invalid_welcome_selection/,
  );
  await f.install();
  const current = await f.inspect();
  const { plan } = await f.post({
    operation: "plan",
    action: "start",
    welcome: true,
    instanceId: "welcome",
    expectedRevision: current.revision,
  });
  await f.post({
    operation: "select-hermes",
    instanceId: "welcome",
    expectedRevision: current.revision,
  });
  await assert.rejects(
    f.post({ operation: "apply", planId: plan.id }),
    /setup_plan_changed/,
  );
  assert.deepEqual(f.calls, ["install"]);
});
test("reload reconstructs an active install without duplication", async (t) => {
  const f = await fixture(t, true);
  const { plan } = await f.post({
    operation: "plan",
    action: "install",
    welcome: true,
    expectedRevision: 0,
    selection: [
      {
        instanceId: "welcome",
        componentId: "hermes",
        mode: "install",
        config: { port: f.port },
      },
    ],
  });
  let s = await f.post({
    operation: "apply",
    planId: plan.id,
    background: true,
  });
  assert.equal(welcomeState(s).phase, "working");
  assert.equal(welcomeState(await f.reload()).phase, "reconcile");
  await assert.rejects(
    f.post({ operation: "apply", planId: plan.id }),
    /setup_busy|setup_outcome_unknown/,
  );
  await f.pending();
  s = await f.inspect();
  assert.equal(welcomeState(s).phase, "model");
});
test("completion is independent of short-lived health and distinguishes a changed configuration", () => {
  const i = {
    componentId: "hermes",
    instanceId: "one",
    installed: true,
    configured: true,
    backendConfigured: true,
    config: { modelName: "model" },
    running: false,
    setupCompletion: { valid: true },
  };
  assert.equal(welcomeState({ instances: [i] }).phase, "ready");
  assert.equal(
    welcomeState({ instances: [{ ...i, setupCompletion: { valid: false } }] })
      .phase,
    "start",
  );
});
test("native job capabilities and speed normalize without private fields", () => {
  const j = validJob({
    job_id: "one",
    bytes_per_sec: 123,
    can_pause: true,
    can_resume: false,
    private_path: "excluded",
  });
  assert.equal(j.bytes_per_second, 123);
  assert.equal(j.can_pause, true);
  assert.equal(j.private_path, undefined);
});
test("bootstrap plans do not download and tampered archives never reach extraction", async (t) => {
  const f = await fixture(t),
    manifest = {
      tools: {
        python: {
          version: "test",
          sha256: digest("expected"),
          url: "https://github.com/astral-sh/python-build-standalone/releases/download/test/python.tar.gz",
          cacheInventory: [
            { path: "bin/python3.14", sha256: digest("binary") },
          ],
        },
      },
    };
  const pin = bootstrapPlan(f.root, manifest);
  assert.equal(pin.kind, "managed");
  let extracted = false;
  await assert.rejects(
    ensureBootstrap(
      pin,
      manifest,
      async () => {
        extracted = true;
      },
      { fetcher: async () => new Response("tampered") },
    ),
    /bootstrap_archive_changed/,
  );
  assert.equal(extracted, false);
});

test("rotating credentials cannot reuse completion or chat with an unapplied key", async (t) => {
  const f = await fixture(t);
  let s = await f.install();
  const { plan } = await f.post({
    operation: "plan",
    action: "setup-hermes",
    welcome: true,
    instanceId: "welcome",
    backend: {
      providerId: "openai-codex",
      modelName: "model",
      backendKind: "remote",
    },
    expectedRevision: s.revision,
  });
  await f.post({ operation: "apply", planId: plan.id });
  await f.post({ operation: "chat", instanceId: "welcome", message: "hello" });
  await f.post({
    operation: "hermes-model",
    instanceId: "welcome",
    modelRequest: {
      action: "connect-key",
      providerId: "openai",
      apiKey: "fixture-new-key",
    },
  });
  s = await f.inspect();
  assert.equal(s.instances[0].backendConfigured, false);
  assert.equal(welcomeState(s).phase, "model");
  await assert.rejects(
    f.post({ operation: "chat", instanceId: "welcome", message: "hello" }),
    /hermes_credentials_changed_reconfigure/,
  );
});

test("release installation source is official Nous and every source pin agrees", async () => {
  const manifest = JSON.parse(
    await readFile("profiles/setup/hermes-installer.json", "utf8"),
  );
  const component = registry.catalog.components.find((c) => c.id === "hermes");
  assert.equal(component.source.repository, "NousResearch/hermes-agent");
  assert.equal(manifest.source.repository, component.source.repository);
  assert.equal(manifest.source.commit, component.source.commit);
  assert.equal(
    manifest.source.url,
    "https://codeload.github.com/NousResearch/hermes-agent/tar.gz/" +
      component.source.commit,
  );
  assert.match(manifest.source.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    digest(await readFile("profiles/setup/hermes-source.json.gz")),
    manifest.source.inventorySha256,
  );
  assert.equal(
    digest(await readFile("profiles/setup/hermes-installer.json")),
    component.artifacts[0].manifestSha256,
  );
});
test("Hermes install review prepares its own bootstrap without executing Homebrew Python", async (t) => {
  const f = await fixture(t);
  const a = adapters({
    root: f.root,
    env: {},
    run: async () => {
      throw Error("must_not_execute_an_external_python");
    },
  });
  const item = {
    componentId: "hermes",
    instanceId: "review-only",
    mode: "install",
    config: {},
    descriptor: registry.catalog.components.find((c) => c.id === "hermes"),
  };
  const result = await a.prepare(item, "install");
  assert.equal(result.bootstrap.kind, "managed");
  assert.ok(
    result.bootstrap.executable.startsWith(f.root + "/cache/bootstrap/"),
  );
  await assert.rejects(access(result.bootstrap.executable));
});

test("installed software goes directly to its default model; unregistered copies need only an installation binding", () => {
  assert.equal(
    welcomeState({ instances: [], hermesInstallations: [{ compatible: true }] })
      .phase,
    "installation",
  );
  assert.equal(
    welcomeState({
      instances: [],
      hermesInstallations: [{ compatible: false }],
    }).phase,
    "installation",
  );
  assert.equal(welcomeState({ instances: [] }).phase, "install");
  assert.equal(
    welcomeState({
      instances: [
        {
          componentId: "hermes",
          instanceId: "a",
          installed: true,
          configured: false,
        },
      ],
    }).phase,
    "model",
  );
  assert.equal(
    welcomeState({
      instances: [
        {
          componentId: "hermes",
          instanceId: "a",
          installed: true,
          configured: false,
          profile: { name: "hub-guide" },
        },
      ],
    }).phase,
    "model",
  );
});

test("Hub entry needs installation, not a configured backend or chat", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.post({ operation: "finish-welcome", expectedRevision: 0 }),
    /hermes_installation_required/,
  );
  await assert.rejects(access(path.join(f.root, "setup.json")));
  let s = await f.install();
  assert.equal(s.instances[0].backendConfigured, false);
  s = await f.post({
    operation: "finish-welcome",
    instanceId: "welcome",
    expectedRevision: s.revision,
  });
  assert.ok(s.welcomeEnteredAt);
  assert.equal(f.messages, 0);
  assert.deepEqual(f.calls, ["install"]);
});
test("detected machine software permits entry without creating or adopting a profile", async (t) => {
  const f = await fixture(t);
  f.setInstallations([{ id: "local", compatible: true }]);
  const s = await f.post({ operation: "finish-welcome", expectedRevision: 0 });
  assert.ok(s.welcomeEnteredAt);
  assert.equal(s.instances.length, 0);
  assert.equal(f.messages, 0);
  assert.deepEqual(f.calls, []);
});

test("default configuration mode cannot be used to smuggle profile paths or templates into another operation", async t => {
 const f=await fixture(t);
 for(const fields of [{operation:"refresh",defaultConfiguration:true},{operation:"plan",action:"install",welcome:true,defaultConfiguration:true},{operation:"plan",action:"create-guide-profile",welcome:true,defaultConfiguration:true,templateId:"other"}])
  await assert.rejects(f.post(fields),/invalid_default_configuration_request/);
 assert.deepEqual(f.calls,[]);
});
