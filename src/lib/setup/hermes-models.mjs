/** Private, per-instance access to the installed Hermes model setup contracts. */
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, lstat, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { check, digest } from "./catalog.mjs";
import { atomic, privateDirectory, readPrivate } from "./state.mjs";
import { endpoint, requestJSON } from "./network.mjs";
import { isInkling, inspectInklingServer } from "./inkling-server.mjs";
const runtimeScript = () => path.join(process.cwd(), "scripts/setup/hermes-runtime.py");


const pending = new Map();
export function idleModelManager(jobs, runtimeAlive) {
  return !runtimeAlive && Array.isArray(jobs) && jobs.every((j) => !["running", "paused"].includes(j.status));
}

const protocol = "zenith.hermes-model-manager.v1";
const sourceScript = () =>
  path.join(process.cwd(), "scripts/setup/hermes-models.py");
const manifestFile = () =>
  path.join(process.cwd(), "profiles/setup/hermes-models.json");
const text = (value, maximum = 240) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  !/[\r\n\0]/.test(value);
export const modelReadActions = new Set([
  "options",
  "models",
  "endpoint-models",
  "oauth-poll",
  "local-job",
  "local-preflight",
]);
const fields = {
  options: [],
  models: ["providerId"],
  "endpoint-models": ["endpoint"],
  "connect-key": ["providerId", "apiKey"],
  "oauth-start": ["providerId"],
  "oauth-poll": ["providerId", "sessionId"],
  "oauth-cancel": ["sessionId"],
  "local-preflight": ["modelId"],
  "local-job": ["jobId"],
  "local-pause": ["jobId"],
  "local-resume": ["jobId"],
};
export function validateModelRequest(body) {
  check(
    body,
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.hasOwn(fields, body.action),
    "invalid_model_request",
  );
  const allowed = ["action", ...fields[body.action]];
  check(
    body,
    Object.keys(body).every((k) => allowed.includes(k) || body.action === "endpoint-models" && k === "secretRef") &&
      allowed.every((k) => Object.hasOwn(body, k)),
    "invalid_model_request",
  );
  for (const k of fields[body.action]) {
    check(
      body,
      text(body[k], k === "apiKey" ? 16384 : k === "endpoint" ? 240 : 160),
      "invalid_model_request",
    );
    if (k === "endpoint") endpoint(body[k]);
    if (!["apiKey", "endpoint"].includes(k))
      check(body, /^[a-zA-Z0-9_.:-]+$/.test(body[k]), "invalid_model_request");
  }
  if (body.secretRef !== undefined)
    check(body, body.action === "endpoint-models" && /^[a-z][a-z0-9-]{0,63}$/.test(body.secretRef), "invalid_model_request");
  return body;
}
function socketRequest(binding, body, timeout = 90000) {
  const bytes = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: binding.socket,
        path: "/request",
        method: "POST",
        headers: {
          Authorization: "Bearer " + binding.token,
          "Content-Type": "application/json",
          "Content-Length": bytes.length,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (b) => {
          size += b.length;
          if (size > 2097152) req.destroy(Error("model_response_too_large"));
          else chunks.push(b);
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks));
            if (res.statusCode !== 200)
              reject(
                Object.assign(Error("hermes_model_action_failed"), {
                  code: data.error || "hermes_model_action_failed",
                  publicMessage: data.message,
                  status: 409,
                }),
              );
            else resolve(data);
          } catch {
            reject(Error("incompatible_hermes_model_contract"));
          }
        });
      },
    );
    req.setTimeout(timeout, () => req.destroy(Error("hermes_model_timeout")));
    req.on("error", reject);
    req.end(bytes);
  });
}
export function validJob(job) {
  job = {
    ...job,
    bytes_per_second: job?.bytes_per_second ?? job?.bytes_per_sec,
  };
  return Object.fromEntries(
    [
      "job_id",
      "kind",
      "target",
      "model_id",
      "status",
      "phase",
      "detail",
      "total_bytes",
      "done_bytes",
      "started_at",
      "bytes_per_second",
      "eta_seconds",
      "can_pause",
      "can_resume",
      "pause_requested",
    ]
      .filter((k) => Object.hasOwn(job || {}, k))
      .map((k) => [k, job[k]]),
  );
}
function publicData(action, data) {
  if (action === "options")
    return { ...data, jobs: (data.jobs || []).map(validJob) };
  if (action === "local-job") return { ...data, job: validJob(data.job) };
  if (action === "oauth-start") {
    const u = new URL(data.verification_url);
    check(
      data,
      u.protocol === "https:" && !u.username && !u.password,
      "invalid_provider_verification_url",
    );
  }
  return data;
}
export function hermesModels({
  setupRoot,
  env = process.env,
  request = socketRequest,
} = {}) {
  async function bindingFor(item) {
    check(
      item,
      item.componentId === "hermes" && item.mode === "install",
      "managed_hermes_required",
    );
    const root = path.join(setupRoot, "instances", item.instanceId);
    const receipt = JSON.parse(
      await readPrivate(path.join(root, "receipt.json")),
    );
    const manifest = JSON.parse(await readFile(manifestFile(), "utf8"));
    if (receipt.software) {
      const {verifySoftware} = await import("./hermes-installations.mjs");
      await verifySoftware(receipt.software,{full:false});
    }
    check(
      receipt,
      receipt.installed === true &&
        receipt.componentId === "hermes" &&
        receipt.source?.commit === manifest.hermesCommit,
      "unsupported_hermes_model_contract",
    );
    check(
      receipt,
      receipt.software
        ? ["source", "environment", "runtimeRoot", "python"].every((k) =>
            path.isAbsolute(receipt.software[k] || ""),
          )
        : /^environment-[a-f0-9]+$/.test(receipt.environment),
      "invalid_hermes_environment",
    );
    const identity = digest(
      (await readFile(sourceScript())) +
        (await readFile(manifestFile())) +
        (await readFile(runtimeScript())) +
        root +
        JSON.stringify([receipt.configurationHome || receipt.profile?.home || path.join(root, "data"), receipt.software || null]),
    );
    const descriptor = path.join(root, "cache", "model-manager.json");
    let existing = await readPrivate(descriptor)
      .then(JSON.parse)
      .catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (existing) {
      let alive = false;
      try {
        process.kill(existing.pid, 0);
        alive = true;
      } catch {}
      if (alive) {
        const info = await lstat(existing.socket);
        check(
          info,
          info.isSocket() && info.uid === process.getuid(),
          "unsafe_model_manager_socket",
        );
        const reply = await request(existing, { action: "ping" });
        check(
          reply,
          reply.protocol === protocol && reply.identity === existing.identity,
          "wrong_hermes_model_manager",
        );
        if (existing.identity === identity) return existing;
        // Refresh only this attested, idle adapter process. Hermes and any live
        // model runtime keep their existing process/engine ownership.
        let runtimeAlive = false;
        for (const directory of [root, path.join(root, "data"), path.join(root, "home/.hermes")]) {
          const state = await readPrivate(path.join(directory, "runtimes/llamacpp/server.json")).then(JSON.parse)
            .catch((e) => { if(e.code === "ENOENT") return null; throw e; });
          if (state?.pid) { try { process.kill(state.pid, 0); runtimeAlive = true; } catch(e) { if(e.code !== "ESRCH") throw e; } }
        }
        const status = await request(existing, { action: "options" });
        check(status, idleModelManager(status.jobs, runtimeAlive), "hermes_model_manager_restart_required");
        const { stdout } = await promisify(execFile)("/bin/ps", ["-ww", "-p", String(existing.pid), "-o", "command="]);
        check(stdout, stdout.includes(sourceScript()) && stdout.includes("--root " + root) && stdout.includes("--identity " + existing.identity), "wrong_hermes_model_manager_process");
        process.kill(existing.pid, "SIGTERM");
        let stopped = false;
        for (let n = 0; n < 50; n++) {
          try { process.kill(existing.pid, 0); } catch(e) { if(e.code === "ESRCH") { stopped = true; break; } throw e; }
          await new Promise((r) => setTimeout(r, 100));
        }
        check(existing, stopped, "hermes_model_manager_restart_required");
        existing = null;
      }
    }
    await privateDirectory(path.join(root, "cache"));
    await privateDirectory(path.join(root, "logs"));
    const socketParent = path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "zn-hub-models-" + process.getuid(),
    );
    await privateDirectory(socketParent);
    const socket = path.join(
      socketParent,
      digest(root).slice(0, 14) +
        "-" +
        randomBytes(4).toString("hex") +
        ".sock",
    );
    const token = randomBytes(32).toString("hex");
    const log = await open(
      path.join(root, "logs", "model-manager.log"),
      "a",
      0o600,
    );
    const privateEnv = await readPrivate(
      path.join(root, "data", "hub-secrets.json"),
    )
      .then(JSON.parse)
      .then((s) => s.HUB_MODEL_API_KEY)
      .catch((e) => {
        if (e.code === "ENOENT") return undefined;
        throw e;
      });
    const child = spawn(
      path.join(
        receipt.software?.environment || path.join(root, receipt.environment),
        "bin/python",
      ),
      [
        "-B",
        sourceScript(),
        "--root",
        root,
        "--manifest",
        manifestFile(),
        "--socket",
        socket,
        "--identity",
        identity,
      ],
      {
        cwd: receipt.software?.source || path.join(root, "source"),
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: {
          PATH: "/usr/bin:/bin:/opt/homebrew/bin",
          LANG: "C.UTF-8",
          HOME: path.join(root, "home"),
          HERMES_HOME: receipt.configurationHome || receipt.profile?.home || path.join(root, "data"),
          HERMES_RUNTIME_DIR:
            receipt.software?.runtimeRoot || path.join(root, "tools"),
          HERMES_DASHBOARD_SESSION_TOKEN: token,
          PYTHONDONTWRITEBYTECODE: "1",
          ...(privateEnv ? { HUB_MODEL_API_KEY: privateEnv } : {}),
        },
      },
    );
    let spawnError;
    child.on("error", (e) => {
      spawnError = e;
    });
    child.unref();
    await log.close();
    const binding = {
      protocol,
      root,
      socket,
      token,
      pid: child.pid,
      identity,
      createdAt: new Date().toISOString(),
    };
    await atomic(descriptor, { ...binding, state: "starting" });
    for (let n = 0; n < 360; n++) {
      check(
        child,
        !spawnError && child.exitCode === null,
        "hermes_model_manager_start_failed",
      );
      try {
        const s = await lstat(socket);
        if (s.isSocket() && s.uid === process.getuid()) {
          const reply = await request(binding, { action: "ping" });
          check(
            reply,
            reply.protocol === protocol && reply.identity === identity,
            "wrong_hermes_model_manager",
          );
          await atomic(descriptor, binding);
          return binding;
        }
      } catch (e) {
        if (e.code !== "ENOENT" && e.code !== "ECONNREFUSED") throw e;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    child.kill("SIGTERM");
    throw Object.assign(Error("hermes_model_manager_start_failed"), {
      code: "hermes_model_manager_start_failed",
    });
  }
  async function binding(item) {
    const key = path.join(setupRoot, "instances", item.instanceId);
    if (!pending.has(key))
      pending.set(
        key,
        bindingFor(item).finally(() => pending.delete(key)),
      );
    return pending.get(key);
  }
  async function endpointToken(item, address, reference) {
    if (reference) {
      const map = JSON.parse(await readPrivate(env.ZENITH_SETUP_SECRETS_FILE));
      check(map, typeof map[reference] === "string", "model_secret_reference_unavailable");
      return (await readPrivate(map[reference], 4096)).trim();
    }
    if ((!item.config?.providerId || item.config.providerId === "custom") && item.config?.modelEndpoint === address)
      return readPrivate(path.join(setupRoot, "instances", item.instanceId, "data/hub-secrets.json"))
        .then(JSON.parse).then((s) => s.HUB_MODEL_API_KEY).catch((e) => { if(e.code === "ENOENT") return undefined; throw e; });
  }
  async function inklingCheck(item, infer = false) {
    if (item.config.providerId !== "custom" || !isInkling(item.config)) return null;
    return inspectInklingServer(item.config, { infer, token: await endpointToken(item, item.config.modelEndpoint, item.config.secretRef) });
  }
  async function persistRuntimeBinding(item) {
    const root = path.join(setupRoot, "instances", item.instanceId);
    const marker = await readPrivate(path.join(root, "process.json")).then(JSON.parse).catch((e) => { if(e.code === "ENOENT") return null; throw e; });
    if (marker) {
      let alive = false; try { process.kill(marker.pid, 0); alive = true; } catch(e) { if(e.code !== "ESRCH") throw e; }
      check(marker, !alive, "stop_hermes_before_runtime_upgrade");
    }
    const receiptFile = path.join(root, "receipt.json");
    const receipt = JSON.parse(await readPrivate(receiptFile));
    const controller = path.join(root, "controller.py");
    check(receipt, digest(await readPrivate(controller)) === receipt.controllerSha256, "installed_controller_changed");
    const runtime = await readFile(runtimeScript()), manifest = await readFile(manifestFile());
    await privateDirectory(path.join(root, "config"));
    async function replace(file, bytes) {
      const tmp = file + ".pending-" + randomBytes(8).toString("hex");
      await writeFile(tmp, bytes, { flag: "wx", mode: 0o600 });
      await rename(tmp, file);
    }
    await replace(path.join(root, "config/hermes-runtime.py"), runtime);
    await replace(path.join(root, "config/hermes-models.json"), manifest);
    const updatedController = await readFile(path.join(process.cwd(), "scripts/setup/instance.py"));
    await replace(controller, updatedController);
    await atomic(receiptFile, { ...receipt, controllerSha256: digest(updatedController),
      modelRuntimeBinding: { scriptSha256: digest(runtime), manifestSha256: digest(manifest) } });
  }
  async function call(item, body, { internal = false } = {}) {
    if (!internal) validateModelRequest(body);
    if (body.action === "endpoint-models") {
      const token = await endpointToken(item, body.endpoint, body.secretRef);
      const result = await requestJSON(body.endpoint, "/v1/models", {
        token,
        timeout: 10000,
      });
      check(
        result,
        result.status === 200 && Array.isArray(result.value.data),
        "model_server_unavailable",
      );
      return {
        models: result.value.data
          .map((m) => m.id)
          .filter((id) => text(id))
          .slice(0, 1000),
      };
    }
    const handle = await binding(item);
    return publicData(body.action, await request(handle, body));
  }
  return {
    request: call,
    async prepareBackend(item) {
      const options = await call(item, { action: "options" });
      const id = item.config.providerId || "custom";
      const provider = options.providers.find((p) => p.id === id);
      check(
        item,
        ["custom", "llamacpp"].includes(id) || provider,
        "unknown_hermes_provider",
      );
      const prerequisites = [];
      if (!item.config.modelName?.trim())
        prerequisites.push("Choose a model before configuring Hermes.");
      if (provider && !provider.credentialConfigured)
        prerequisites.push(
          "Connect this provider with Hermes before selecting its model.",
        );
      if (id === "custom") {
        endpoint(item.config.modelEndpoint);
        if (item.config.contextLength && item.config.contextLength < 64000)
          prerequisites.push(
            "Hermes requires at least 64,000 tokens of served context. Configure the model server for that window before continuing.",
          );
      }
      const inkling = await inklingCheck(item);
      if (inkling) prerequisites.push(...inkling.prerequisites);
      return {
        artifacts: [],
        prerequisites,
        effects: [
          ...(inkling ? ["Verify live Inkling model discovery, the reviewed engine/quantization and at least 64,000 served tokens. On apply, send one synthetic chat readiness probe before changing the Hermes model. No page or conversation content is sent."] : []),
          "Select the declared model through Hermes’s native provider configuration. Preserve the API identity, credentials, profile data and other model settings.",
        ],
      };
    },
    async prepareLocal(item, { prepareAPI = false } = {}) {
      check(
        item,
        item.componentId === "hermes" && item.config.providerId === "llamacpp",
        "managed_local_model_required",
      );
      const receipt = JSON.parse(
        await readPrivate(
          path.join(setupRoot, "instances", item.instanceId, "receipt.json"),
        ),
      );
      const data = await call(item, {
        action: "local-preflight",
        modelId: item.config.localModelId,
      });
      return {
        artifacts: [],
        prerequisites: [
          ...data.prerequisites,
          ...(!receipt.configured && !prepareAPI
            ? ["Configure the Hermes API before installing its local model."]
            : []),
        ],
        effects: [
          "Install Hermes’s managed local runtime if needed, download the selected pinned model, verify its hashes, start its local server and select it for new Hermes sessions.",
          "Model weights and server state remain in this Hermes instance.",
          ...(data.effects || []),
          ...(data.quantization ? [
            "Quantization: " + data.quantization + "; model publisher: " + data.source.publisher + "; quantization publisher: " + data.source.quantizationPublisher + ".",
            "Source: " + data.source.repository + " @ " + data.source.revision + ".",
            "Runtime: " + data.engine.repository + " " + data.engine.release + " (release tag target " + data.engine.commit + "; archive SHA256 " + data.engine.sha256 + "); install destination: " + data.engineDirectory + ".",
            "Memory estimate (not measured): " + (data.memory.estimatedWorkingSetBytes / 1024 ** 3).toFixed(1) + " GiB working set including weights, 65,536-token cache and overhead; " + (data.memory.estimatedTotalBytes / 1024 ** 3).toFixed(1) + " GiB including reserve and other running services.",
            "Experimental; no local inference or onboarding-quality qualification. Apache-2.0 notices: " + data.notice + "."
          ] : []),
        ],
        runtimePins: { localModel: data },
        progressFile: path.join(
          setupRoot,
          "instances",
          item.instanceId,
          "local-model-operation.json",
        ),
      };
    },
    async setupLocal(plan) {
      const item = { ...plan, mode: "install" };
      const file = path.join(plan.root, "local-model-operation.json");
      if (item.config.localModelId === "inkling-2-mini") await persistRuntimeBinding(item);
      let retained;
      try {
        const previous = JSON.parse(await readPrivate(file));
        if (previous.modelId === item.config.localModelId && previous.jobId) {
          const existing = await call(item, {
            action: "local-job",
            jobId: previous.jobId,
          });
          if (!["error", "cancelled"].includes(existing.job.status))
            retained = { job_id: previous.jobId };
        }
      } catch {}
      const job =
        retained ||
        (await call(
          item,
          { action: "local-start", modelId: item.config.localModelId },
          { internal: true },
        ));
      const deadline = Date.now() + 4 * 60 * 60 * 1000;
      while (Date.now() < deadline) {
        const data = await call(item, {
          action: "local-job",
          jobId: job.job_id,
        });
        const p = data.job;
        await atomic(file, {
          planDigest: plan.digest,
          modelId: item.config.localModelId,
          state:
            p.status === "done"
              ? "prepared"
              : p.status === "error"
                ? "failed-retained"
                : "applying",
          phase: p.phase,
          jobState: p.status,
          canPause: p.can_pause === true,
          canResume: p.can_resume === true,
          jobId: job.job_id,
          completed: p.done_bytes,
          total: p.total_bytes,
          artifact: p.target,
          updatedAt: new Date().toISOString(),
        });
        if (p.status === "done") {
          const backend = Object.fromEntries(
            Object.entries({
              ...data.configuration,
              backendKind: "local",
              localModelId: plan.config.localModelId,
            }).filter(([, v]) => v !== null && v !== undefined && v !== ""),
          );
          const root = path.join(setupRoot, "instances", item.instanceId);
          const receipt = JSON.parse(
            await readPrivate(path.join(root, "receipt.json")),
          );
          await atomic(path.join(root, "receipt.json"), {
            ...receipt,
            backendConfigured: true,
          });
          return { backend };
        }
        check(p, p.status !== "error", "local_model_setup_failed_retained");
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw Object.assign(Error("local_model_setup_outcome_unknown"), {
        code: "local_model_setup_outcome_unknown",
      });
    },
    async configureAPI(item) {
      return call(item, { action: "configure-api", apiPort: item.config.port }, { internal: true });
    },
    async applyBackend(item) {
      const verified = await inklingCheck(item, true);
      if (verified?.prerequisites.length) throw Object.assign(Error("inkling_server_not_qualified"), {
        code: "inkling_server_not_qualified", publicMessage: verified.prerequisites.join(" ")
      });
      return call(
        item,
        {
          action: "apply-backend",
          providerId: item.config.providerId,
          modelName: item.config.modelName,
          baseUrl: item.config.modelEndpoint
            ? item.config.modelEndpoint.replace(/\/$/, "") +
              (item.config.modelEndpoint.endsWith("/v1") ? "" : "/v1")
            : "",
          contextLength: verified?.contextLength || item.config.contextLength,
          apiPort: item.config.port,
          useHubKey: !!item.config.secretRef,
        },
        { internal: true },
      );
    },
  };
}
