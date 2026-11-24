/** Built normal/standalone setup contract, cold-state and prerequisite checks. No installer apply. */
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, access } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const standalone = process.argv.includes("--standalone"),
  listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const componentSocket = createServer();
await new Promise((r) => componentSocket.listen(0, "127.0.0.1", r));
const componentPort = componentSocket.address().port;
await new Promise((r) => componentSocket.close(r));
const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "hub-setup-package-")),
  ),
  destination = path.join(root, "not-created"),
  origin = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  standalone
    ? [".next/standalone/server.js"]
    : ["scripts/operator.mjs", "--production"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ZENITH_OPERATOR_PORT: String(port),
      ZENITH_OPERATOR_ORIGIN: origin,
      ZENITH_LOCAL_OPERATOR: "1",
      ZENITH_GUIDED_SETUP: "1",
      ZENITH_HUB_SETUP_DIR: destination,
      ZENITH_SETUP_PYTHON: "/definitely-absent/setup-python",
      ZENITH_HUB_DATA_DIR: path.join(root, "objects"),
      ZENITH_PROCESS_PROFILE: "installation",
      ZENITH_NATIVE_DEMO: "0",
      ZENITH_CONTAINER_DEMO: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const s of [child.stdout, child.stderr])
  s.on("data", (b) => (logs = (logs + b).slice(-12000)));
try {
  let session;
  for (let n = 0; n < 100; n++) {
    try {
      const r = await fetch(origin + "/api/setup", {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        session = await r.json();
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(session?.mode, "local", logs);
  assert.equal(session.revision, 0);
  assert.equal(session.instances.length, 0);
  await assert.rejects(access(destination));
  const page = await fetch(origin + "/setup");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<h1[^>]*>Zenith Hub · Hermes<\/h1>/);
  async function post(body, headers = {}) {
    const r = await fetch(origin + "/api/setup", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Zenith-CSRF": session.csrf,
        ...headers,
      },
      body: JSON.stringify({ schema: "zenith.hub-setup-action.v1", ...body }),
      signal: AbortSignal.timeout(15000),
    });
    return { status: r.status, value: await r.json() };
  }
  const plan = await post({
    operation: "plan",
    action: "install",
    expectedRevision: 0,
    selection: [
      {
        componentId: "hermes",
        instanceId: "missing-python",
        mode: "install",
        config: { port: componentPort },
      },
    ],
  });
  assert.equal(plan.status, 200, JSON.stringify(plan.value));
  assert.ok(
    plan.value.plan.items[0].prerequisites.some((v) =>
      v.includes("Install Python 3.12"),
    ),
  );
  assert.equal(plan.value.plan.items[0].bootstrap, null);
  const apply = await post({ operation: "apply", planId: plan.value.plan.id });
  assert.equal(apply.status, 409);
  assert.equal(apply.value.error, "unmet_prerequisites");
  await assert.rejects(access(destination));
  const denied = await post(
    { operation: "save", selection: [], step: "welcome", expectedRevision: 0 },
    { Origin: "https://untrusted.invalid" },
  );
  assert.equal(denied.status, 403);
  const after = await (await fetch(origin + "/api/setup")).json();
  assert.equal(after.revision, 0);
  console.log(
    JSON.stringify({
      passed: true,
      standalone,
      coldStateReadOnly: true,
      missingPythonBlocksApply: true,
      privateBoundaryPreserved: true,
    }),
  );
} catch (e) {
  console.error(logs);
  throw e;
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((r) => child.once("exit", r));
  await rm(root, { recursive: true, force: true });
}
