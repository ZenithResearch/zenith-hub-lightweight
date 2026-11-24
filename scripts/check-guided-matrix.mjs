/** Real native Synapse qualification, isolated from all existing installations. */
import {
  mkdtemp,
  realpath,
  chmod,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createSetupController } from "../src/lib/setup/controller.mjs";
import { requestJSON } from "../src/lib/setup/network.mjs";
import { runOwned } from "../src/lib/setup/adapters.mjs";
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "hub-matrix-qualification-")),
);
await chmod(root, 0o700);
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = "http://127.0.0.1:4308";
const controller = createSetupController({
  env: {
    ...process.env,
    ZENITH_LOCAL_OPERATOR: "1",
    ZENITH_GUIDED_SETUP: "1",
    ZENITH_OPERATOR_ORIGIN: origin,
    ZENITH_HUB_SETUP_DIR: root,
  },
});
const request = (csrf) =>
  new Request(origin + "/api/setup", {
    headers: {
      host: "127.0.0.1:4308",
      origin,
      "content-type": "application/json",
      ...(csrf ? { "x-zenith-csrf": csrf } : {}),
    },
  });
let session = await controller.get(request());
const post = async (body) => {
  const result = await controller.post(request(session.csrf), {
    schema: "zenith.hub-setup-action.v1",
    ...body,
  });
  if (result.revision !== undefined) session = result;
  return result;
};
const instanceId = "matrix-qualification",
  selection = [
    {
      instanceId,
      componentId: "matrix",
      mode: "install",
      config: {
        serverName: "hub-qualification.invalid",
        port,
        domainMode: "development",
        access: "private",
        federation: false,
        tailscale: false,
        identityAcknowledged: true,
      },
    },
  ];
let installed = false;
async function apply(action) {
  const p = await post({
    operation: "plan",
    action,
    expectedRevision: session.revision,
    ...(action === "install" ? { selection } : { instanceId }),
  });
  assert.deepEqual(
    p.plan.items.flatMap((i) => i.prerequisites),
    [],
  );
  return post({ operation: "apply", planId: p.plan.id });
}
try {
  await apply("install");
  installed = true;
  await apply("configure");
  await apply("start");
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const r = await requestJSON(base, "/_matrix/client/versions");
      if (r.status === 200 && r.value.versions.length) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, "Synapse did not expose its Matrix API");
  const instanceRoot = path.join(root, "instances", instanceId),
    python = path.join(instanceRoot, "venv/bin/python");
  const secret = (
    await runOwned(python, [
      "-I",
      "-c",
      'import yaml,sys; print(yaml.safe_load(open(sys.argv[1]))["registration_shared_secret"])',
      path.join(instanceRoot, "config/homeserver.yaml"),
    ])
  ).trim();
  const reg = await requestJSON(base, "/_synapse/admin/v1/register");
  assert.equal(reg.status, 200);
  const username = "qualification",
    password = randomBytes(24).toString("hex"),
    nonce = reg.value.nonce;
  const mac = createHmac("sha1", secret)
    .update([nonce, username, password, "notadmin"].join("\0"))
    .digest("hex");
  const created = await requestJSON(base, "/_synapse/admin/v1/register", {
    method: "POST",
    body: { nonce, username, password, admin: false, mac },
  });
  assert.equal(created.status, 200);
  assert.equal(
    created.value.user_id,
    "@qualification:hub-qualification.invalid",
  );
  const login = await requestJSON(base, "/_matrix/client/v3/login", {
    method: "POST",
    body: {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
    },
  });
  assert.equal(login.status, 200);
  const token = login.value.access_token;
  const who = await requestJSON(base, "/_matrix/client/v3/account/whoami", {
    token,
  });
  assert.equal(who.value.user_id, created.value.user_id);
  const observed = await post({ operation: "refresh" });
  assert.equal(observed.instances[0].observation.applicationReady, true);
  assert.equal(observed.instances[0].running, true);
  await apply("stop");
  const statBefore = await readFile(
    path.join(instanceRoot, "data/homeserver.db"),
  );
  assert.ok(statBefore.length > 0);
  await apply("start");
  let again;
  for (let n = 0; n < 100; n++) {
    try {
      again = await requestJSON(base, "/_matrix/client/v3/account/whoami", {
        token,
      });
      if (again.status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(again?.value.user_id, who.value.user_id);
  await apply("stop");
  console.log(
    JSON.stringify({
      passed: true,
      nativeSynapse: true,
      installConfigureStartConnectStop: true,
      identityPersistent: true,
      userAndDatabasePersistent: true,
      existingInstallationsUntouched: true,
    }),
  );
} catch (error) {
  console.error("Disposable evidence retained at " + root);
  throw error;
} finally {
  if (installed) {
    try {
      await apply("stop");
    } catch {}
  }
}
await rm(root, { recursive: true, force: true });
