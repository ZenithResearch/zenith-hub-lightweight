import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  rename,
  symlink,
  copyFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createController } from "../../src/lib/pilot-controller.mjs";
import {
  readAction,
  normalizeNextRequest,
} from "../../src/lib/operator-http.mjs";
const origin = "http://127.0.0.1:4208";
function request(headers = {}, method = "GET", body) {
  return new Request(origin + "/api/deployer", {
    method,
    headers: { host: "127.0.0.1:4208", ...headers },
    ...(body ? { body, duplex: "half" } : {}),
  });
}
async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "zenith-controller-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "installation"),
    bundle = path.join(base, "bundle");
  await mkdir(bundle);
  await writeFile(path.join(bundle, "bundle.json"), "{}");
  await copyFile(
    "profiles/process-macos/release.v1.json",
    path.join(bundle, "profile.json"),
  );
  const calls = [];
  let now = 100;
  const env = {
    ZENITH_LOCAL_OPERATOR: "1",
    ZENITH_PROCESS_ROOT: root,
    ZENITH_PROCESS_BUNDLE: bundle,
  };
  const run = async (exe, args, options) => {
    calls.push({ exe, args, options });
    const action = args[4];
    if (action === "install") await mkdir(root);
    return {
      stdout: JSON.stringify({
        installed: true,
        authority: "pending",
        pilot_ready: false,
        external_effects: false,
        frank: { actor_count: 0 },
        components: {
          service: { live: true, ready: false, managed: true },
          runtime: { live: true, ready: false, managed: true },
        },
        secret: "NEVER_PROJECT_THIS",
      }),
    };
  };
  const c = createController({
    env,
    platform: "darwin",
    arch: "arm64",
    run,
    clock: () => now,
  });
  const snapshot = await c.get(request());
  const post = (body, headers = {}) =>
    c.post(
      request(
        {
          origin: origin,
          "content-type": "application/json",
          "x-zenith-csrf": snapshot.csrf,
          ...headers,
        },
        "POST",
      ),
      { schema: "zenith.deployer-action.v1", ...body },
    );
  return {
    c,
    post,
    env,
    root,
    bundle,
    calls,
    advance: () => {
      now += 60001;
    },
  };
}
test("hosted or unsupported host never invokes local controller", async () => {
  for (const opts of [
    { env: {} },
    { env: { ZENITH_LOCAL_OPERATOR: "1" }, platform: "linux" },
  ]) {
    const c = createController({ ...opts, run: () => assert.fail("executed") });
    assert.equal((await c.get(request())).mode, "disabled");
    await assert.rejects(c.post(request(), {}), {
      code: "local_operator_disabled",
    });
  }
});
test("same origin, Host and CSRF are required before any action", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { origin: "https://evil.example" },
    { host: "evil.example" },
    { "x-zenith-csrf": "bad" },
    { "sec-fetch-site": "cross-site" },
    { "content-type": "text/plain" },
  ])
    await assert.rejects(
      f.post({ operation: "plan", action: "install" }, headers),
    );
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.c.get(request({ host: "localhost:4208" })), {
    code: "wrong_host",
  });
});
test("browser cannot choose paths, commands, policy or extra fields", async (t) => {
  const f = await fixture(t);
  for (const body of [
    { operation: "plan", action: "install", root: "/tmp/elsewhere" },
    { operation: "plan", action: "sh" },
    { operation: "plan", action: "status" },
    { operation: "plan", action: ["install"] },
    { operation: "apply", plan_id: "missing" },
    { operation: "plan", action: "install", policy: "allow" },
  ])
    await assert.rejects(f.post(body));
  assert.equal(f.calls.length, 0);
});
test("review binds action/destination/digest; apply consumes it and projects no child secrets", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.post({ operation: "plan", action: "install" });
  assert.equal(plan.target, f.root);
  assert.match(plan.release_digest, /^[a-f0-9]{64}$/);
  assert.equal(f.calls.length, 0);
  const result = await f.post({ operation: "apply", plan_id: plan.id });
  assert.equal(result.applied, true);
  assert.equal(result.status.installed, true);
  assert.equal(result.status.pilot_ready, false);
  assert.ok(!JSON.stringify(result).includes("NEVER_PROJECT"));
  assert.equal(f.calls[0].args[4], "install");
  assert.equal(f.calls[0].options.shell, false);
  assert.ok(f.calls[0].args.includes(plan.release_digest));
  await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), {
    code: "unknown_plan",
  });
});
test("expired or changed bundles and targets reject before executing", async (t) => {
  for (const change of ["expiry", "bundle", "root"]) {
    const f = await fixture(t);
    const { plan } = await f.post({ operation: "plan", action: "install" });
    if (change === "expiry") f.advance();
    if (change === "bundle")
      await writeFile(path.join(f.bundle, "bundle.json"), "changed");
    if (change === "root") await mkdir(f.root);
    await assert.rejects(f.post({ operation: "apply", plan_id: plan.id }), {
      code: "plan_changed_or_expired",
    });
    assert.equal(f.calls.length, 0);
  }
});
test("symlink destination is rejected", async (t) => {
  const f = await fixture(t);
  await symlink(f.bundle, f.root);
  await assert.rejects(f.c.get(request()), { code: "unsafe_target" });
});
test("a running apply excludes another and errors contain no child output", async (t) => {
  const f = await fixture(t);
  await mkdir(f.root);
  let rejectRun;
  let entered;
  const started = new Promise((r) => {
    entered = r;
  });
  const c = createController({
    env: f.env,
    platform: "darwin",
    arch: "arm64",
    run: () =>
      new Promise((_, reject) => {
        rejectRun = reject;
        entered();
      }),
  });
  const pending = c.get(request());
  await started;
  rejectRun(new Error("SECRET"));
  await assert.rejects(pending, { code: "controller_rejected" });
  let release;
  let enterApply;
  const applying = new Promise((r) => {
    enterApply = r;
  });
  const control = createController({
    env: { ...f.env, ZENITH_PROCESS_ROOT: f.root + "-new" },
    platform: "darwin",
    arch: "arm64",
    run: () =>
      new Promise((r) => {
        release = r;
        enterApply();
      }),
  });
  const s = await control.get(request());
  const post = (body) =>
    control.post(
      request(
        { origin, "content-type": "application/json", "x-zenith-csrf": s.csrf },
        "POST",
      ),
      { schema: "zenith.deployer-action.v1", ...body },
    );
  const { plan } = await post({ operation: "plan", action: "install" });
  const apply = post({ operation: "apply", plan_id: plan.id });
  await applying;
  await assert.rejects(post({ operation: "apply", plan_id: plan.id }), {
    code: "operation_in_progress",
  });
  release({ stdout: "{}" });
  await apply;
});
test("HTTP body limits bytes, malformed JSON/UTF8 and slow streams", async () => {
  assert.deepEqual(await readAction(request({}, "POST", "{}")), {});
  await assert.rejects(
    readAction(request({ "content-length": "9999" }, "POST", "{}")),
    { code: "request_too_large" },
  );
  await assert.rejects(readAction(request({}, "POST", "x".repeat(2049))), {
    code: "request_too_large",
  });
  await assert.rejects(readAction(request({}, "POST", "{")), {
    code: "invalid_request",
  });
  await assert.rejects(readAction(request({}, "POST", new Uint8Array([255]))), {
    code: "invalid_request",
  });
  const body = new ReadableStream({ start() {} });
  await assert.rejects(
    readAction(request({}, "POST", body), { deadline: 10 }),
    { code: "request_timeout" },
  );
});

test("Next internal origin normalization is fixed to numeric loopback and same port", () => {
  const normalized = normalizeNextRequest(
    new Request("http://localhost:4208/api/deployer", {
      headers: { host: "127.0.0.1:4208", "x-forwarded-host": "evil.example" },
    }),
  );
  assert.equal(new URL(normalized.url).origin, origin);
  for (const [url, host] of [
    ["http://evil.example:4208/api/deployer", "127.0.0.1:4208"],
    ["http://localhost:9999/api/deployer", "127.0.0.1:4208"],
    ["https://localhost:4208/api/deployer", "127.0.0.1:4208"],
    [origin + "/api/deployer", "evil.example"],
  ])
    assert.throws(
      () => normalizeNextRequest(new Request(url, { headers: { host } })),
      { code: "wrong_host" },
    );
});

test("operator only offers the repository-pinned release profile", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.bundle, "profile.json"), "{}");
  await assert.rejects(f.post({ operation: "plan", action: "install" }), {
    code: "unrecognized_release",
  });
  assert.equal(f.calls.length, 0);
});

test("concurrent plan preparation cannot exceed the eight-plan cap", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      f.post({ operation: "plan", action: "install" }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 8);
  for (const r of results.filter((r) => r.status === "rejected"))
    assert.equal(r.reason.code, "too_many_plans");
});
test("expiry is checked again after asynchronous binding reads", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.post({ operation: "plan", action: "install" });
  const pending = f.post({ operation: "apply", plan_id: plan.id });
  f.advance();
  await assert.rejects(pending, { code: "plan_changed_or_expired" });
  assert.equal(f.calls.length, 0);
});

test("unresolved cleanup during status blocks both future polls and mutations", async (t) => {
  const f = await fixture(t);
  await mkdir(f.root);
  let calls = 0;
  const c = createController({
    env: f.env,
    platform: "darwin",
    arch: "arm64",
    run: async () => {
      calls++;
      const e = new Error("private diagnostic");
      e.code = "OPERATOR_CLEANUP_UNRESOLVED";
      throw e;
    },
  });
  await assert.rejects(c.get(request()), {
    code: "controller_cleanup_unresolved",
  });
  const snapshot = await c.get(request());
  assert.equal(snapshot.busy, true);
  assert.equal(snapshot.status, null);
  assert.deepEqual(snapshot.actions, []);
  assert.equal(calls, 1);
  await assert.rejects(
    c.post(
      request(
        {
          origin,
          "content-type": "application/json",
          "x-zenith-csrf": snapshot.csrf,
        },
        "POST",
      ),
      {
        schema: "zenith.deployer-action.v1",
        operation: "plan",
        action: "start",
      },
    ),
    { code: "operation_in_progress" },
  );
  assert.equal(calls, 1);
});
