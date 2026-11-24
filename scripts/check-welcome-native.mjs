/** Optional Apple-silicon native qualification. Uses only a disposable QA root. */
import {
  mkdtemp,
  realpath,
  chmod,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createSetupController } from "../src/lib/setup/controller.mjs";
const base = process.env.ZENITH_WELCOME_QA_PARENT || os.tmpdir();
const root = await realpath(
  process.env.ZENITH_WELCOME_QA_ROOT ||
    (await mkdtemp(path.join(base, "hub-welcome-native-"))),
);
if (!root.startsWith(base + "/hub-welcome-native-"))
  throw Error("invalid_qa_root");
await chmod(root, 0o700);
const origin = "http://127.0.0.1:4308";
const env = {
  ZENITH_LOCAL_OPERATOR: "1",
  ZENITH_GUIDED_SETUP: "1",
  ZENITH_OPERATOR_ORIGIN: origin,
  ZENITH_HUB_SETUP_DIR: root,
  ...(process.env.ZENITH_QA_HERMES_SOURCE_CACHE
    ? {
        ZENITH_SETUP_HERMES_SOURCE_CACHE:
          process.env.ZENITH_QA_HERMES_SOURCE_CACHE,
      }
    : {}),
  ...(process.env.ZENITH_QA_HERMES_TOOL_CACHE
    ? {
        ZENITH_SETUP_HERMES_TOOL_CACHE: process.env.ZENITH_QA_HERMES_TOOL_CACHE,
      }
    : {}),
};
const controller = createSetupController({ env, projector: async () => {} });
const request = (csrf) =>
  new Request(origin + "/api/setup", {
    headers: {
      host: "127.0.0.1:4308",
      origin,
      "content-type": "application/json",
      ...(csrf ? { "x-zenith-csrf": csrf } : {}),
    },
  });
let session = await controller.get(request()),
  instance,
  timer,
  fixtureRequests = 0;
const post = (body) =>
  controller.post(request(session.csrf), {
    schema: "zenith.hub-setup-action.v1",
    ...body,
  });
const fixture = createServer((req, res) => {
  let bytes = "";
  req.on("data", (b) => (bytes += b));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models")
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "fixture-model", object: "model", context_length: 65536 },
          ],
        }),
      );
    else {
      fixtureRequests++;
      res.end(
        JSON.stringify({
          id: "qa-completion",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "fixture-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Hermes native verification reply.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
        }),
      );
    }
  });
});
const report = {
  root,
  bootstrap:
    process.env.ZENITH_QA_REUSE_HERMES === "1"
      ? "Existing verified Hermes software/runtime reused"
      : "Hub-managed pinned Python; no ZENITH_SETUP_PYTHON",
  checks: [],
  model:
    "Local deterministic protocol fixture, no cloud account or model-quality claim",
};
try {
  if (session.instances.some((i) => i.installed === true)) {
    report.checks.push(
      process.env.ZENITH_QA_REUSE_HERMES === "1"
        ? "Retained Hub guide reuses the detected software installation"
        : "Retained fresh managed-bootstrap source installation verified",
    );
  } else if (process.env.ZENITH_QA_REUSE_HERMES !== "1") {
    if (session.instances.length)
      session = await post({ operation: "reconcile" });
    const reviewed = await post({
      operation: "plan",
      action: session.instances.length ? "resume-install" : "install",
      welcome: true,
      expectedRevision: session.revision,
      ...(session.instances.length
        ? { instanceId: "native-qa" }
        : {
            selection: [
              {
                componentId: "hermes",
                instanceId: "native-qa",
                mode: "install",
                config: {},
              },
            ],
          }),
    });
    if (reviewed.plan.items[0].prerequisites.length)
      throw Error(JSON.stringify(reviewed.plan.items[0].prerequisites));
    if (reviewed.plan.items[0].bootstrap.kind !== "managed")
      throw Error("not_managed_bootstrap");
    console.log(
      JSON.stringify({
        phase: "installing",
        root,
        source: reviewed.plan.items[0].descriptor.source.commit,
        bootstrap: "managed",
      }),
    );
    timer = setInterval(async () => {
      try {
        console.log(
          JSON.stringify({
            phase: JSON.parse(
              await readFile(
                path.join(root, "instances/native-qa/operation.json"),
                "utf8",
              ),
            ).state,
          }),
        );
      } catch {
        console.log('{"phase":"preparing-bootstrap"}');
      }
    }, 15000);
    session = await post({ operation: "apply", planId: reviewed.plan.id });
    clearInterval(timer);
    report.checks.push(
      "Fresh source installation completed with the managed bootstrap",
    );
  }
  if (process.env.ZENITH_QA_REUSE_HERMES === "1" && !session.instances.length) {
    const installed = session.hermesInstallations.find((i) => i.compatible);
    if (!installed) throw Error("compatible_installation_not_found");
    const reviewed = await post({
      operation: "plan",
      action: "create-guide-profile",
      defaultConfiguration: true,
      welcome: true,
      expectedRevision: session.revision,
      installationId: installed.id,
      selection: [
        {
          componentId: "hermes",
          instanceId: "native-qa",
          mode: "install",
          config: {},
        },
      ],
    });
    session = await post({ operation: "apply", planId: reviewed.plan.id });
    report.checks.push(
      "Detected software reused without a source/runtime reinstall",
    );
  }
  instance = session.instances[0];
  if (process.env.ZENITH_QA_REUSE_HERMES === "1" && !instance.configurationHome)
    throw Error("missing_default_configuration_binding");
  if (instance.profile) throw Error("unexpected_named_profile");
  report.checks.push("Default Hermes configuration reused without creating a named profile");
  const options = await post({
    operation: "hermes-model",
    instanceId: instance.instanceId,
    modelRequest: { action: "options" },
  });
  if (!options.data.providers.length || !options.data.localModels.length)
    throw Error("missing_native_options");
  report.checks.push(
    "Native provider catalog and machine-sized model options loaded from installed source",
  );
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const endpoint = "http://127.0.0.1:" + fixture.address().port;
  session = await controller.get(request());
  const configured = await post({
    operation: "plan",
    action: "setup-hermes",
    welcome: true,
    instanceId: instance.instanceId,
    expectedRevision: session.revision,
    backend: {
      providerId: "custom",
      backendKind: "local",
      modelName: "fixture-model",
      contextLength: 65536,
      modelEndpoint: endpoint,
    },
  });
  if (configured.plan.items[0].prerequisites.length)
    throw Error(JSON.stringify(configured.plan.items[0].prerequisites));
  session = await post({ operation: "apply", planId: configured.plan.id });
  report.checks.push(
    "Reviewed composite configured the private API/model and started Hermes while staying on welcome",
  );
  if (
    session.step !== "welcome" ||
    !session.instances[0].observation.chatAvailable
  )
    throw Error("hermes_not_available");
  if (fixtureRequests) throw Error("unexpected_automatic_chat");
  session = await post({
    operation: "chat",
    instanceId: instance.instanceId,
    message: "Reply with a short greeting. Verification " + Date.now(),
  });
  if (!session.instances[0].setupCompletion?.valid || !fixtureRequests)
    throw Error("missing_real_hermes_reply");
  report.checks.push(
    "Explicit question traversed the real Hermes API/agent and local protocol fixture",
  );
  const reload = createSetupController({ env, projector: async () => {} }),
    after = await reload.get(request());
  if (!after.instances[0].setupCompletion.valid)
    throw Error("completion_not_durable");
  report.checks.push("Controller reload retained completion evidence");
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.code || e.message;
  console.error(JSON.stringify({ error: report.error }));
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  try {
    session = await controller.get(request());
    const i = session.instances[0];
    if (i?.running) {
      const { plan } = await post({
        operation: "plan",
        action: "stop",
        instanceId: i.instanceId,
        expectedRevision: session.revision,
      });
      await post({ operation: "apply", planId: plan.id });
    }
  } catch (e) {
    report.stopError = e.code || e.message;
  }
  try {
    const m = JSON.parse(
      await readFile(
        path.join(root, "instances/native-qa/cache/model-manager.json"),
        "utf8",
      ),
    );
    const cmd = execFileSync(
      "/bin/ps",
      ["-ww", "-p", String(m.pid), "-o", "command="],
      { encoding: "utf8" },
    );
    if (cmd.includes(root) && cmd.includes("hermes-models.py"))
      process.kill(m.pid, "SIGTERM");
  } catch {}
  if (fixture.listening) await new Promise((r) => fixture.close(r));
  await writeFile(
    path.join(root, "qualification.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
