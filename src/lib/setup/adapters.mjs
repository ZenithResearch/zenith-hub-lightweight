import {readMatrixSession} from "./matrix-session.mjs";
import { matrixAdapter } from "./matrix.mjs";
import { pythonPreflight, verifyExecutable } from "./preflight.mjs";
import { readFile, lstat, access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tailscaleAdapter } from "./tailscale.mjs";
import { vpsAdapter } from "./vps.mjs";
import { hermesInstallations } from "./hermes-installations.mjs";
import { hermesAdapter } from "./hermes.mjs";
import { hermesModels } from "./hermes-models.mjs";
import { check, digest } from "./catalog.mjs";
import { readPrivate } from "./state.mjs";
import { probe, endpoint } from "./network.mjs";
export async function runOwned(
  executable,
  args,
  { input, timeout = 300000, logFile } = {},
) {
  return new Promise((resolve, reject) => {
    let output = "",
      failure = null,
      killer;
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin:/opt/homebrew/bin",
        LANG: "C.UTF-8",
        ...(process.platform === "darwin"
          ? { SSL_CERT_FILE: "/etc/ssl/cert.pem" }
          : {}),
      },
      detached: true,
    });
    function terminate(reason) {
      failure = reason;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      killer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 1000);
    }
    const timer = setTimeout(
      () => terminate("adapter_timeout_outcome_unknown"),
      timeout,
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (b) => {
        output = (output + b).slice(-1048576);
      });
    child.on("error", (e) => {
      failure = e.code || "adapter_spawn_failed";
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      try {
        if (logFile) {
          await mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 });
          await writeFile(logFile, output, { mode: 0o600, flag: "wx" });
        }
        if (failure || code !== 0)
          reject(
            Object.assign(
              Error(failure || "adapter_failed_inspect_private_log"),
              { code: failure || "adapter_failed_inspect_private_log" },
            ),
          );
        else resolve(output);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", () =>
      reject(Object.assign(Error("port_in_use"), { code: "port_in_use" })),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
export function adapters({
  root,
  env = process.env,
  run = runOwned,
  netProbe = probe,
} = {}) {
  const python = env.ZENITH_SETUP_PYTHON || "/opt/homebrew/bin/python3.12",
    script = path.join(process.cwd(), "scripts/setup/instance.py");
  const installations = hermesInstallations({ setupRoot: root, env, run });
  const modelManager = hermesModels({ setupRoot: root, env });
  const network = tailscaleAdapter({ env, run });
  const vps = vpsAdapter({ env, run, setupRoot: root });
  const matrix = matrixAdapter({ root, env, run, python });
  const hermes = hermesAdapter({
    env,
    run,
    python,
    instanceScript: script,
    setupRoot: root,
    modelManager,
  });
  async function filesFor(item, { verify = true } = {}) {
    if (item.componentId === "matrix" && !env.ZENITH_SETUP_MATRIX_WHEELHOUSE) {
      const prepared = await matrix.prepared(item);
      check(prepared, prepared.receipt, "matrix_artifacts_not_prepared");
      return prepared.receipt.artifacts.map((f) => ({
        ...f,
        path: path.join(prepared.directory, "wheels", f.filename),
      }));
    }
    const lock = JSON.parse(
      await readFile(
        path.join(process.cwd(), "profiles/setup/artifacts.darwin-arm64.json"),
        "utf8",
      ),
    );
    const rows = [];
    for (const group of item.descriptor.artifacts) {
      const dir =
        group.group === "base"
          ? env.ZENITH_SETUP_BASE_WHEELHOUSE
          : env.ZENITH_SETUP_MATRIX_WHEELHOUSE;
      check(dir, !dir || path.isAbsolute(dir), "artifact_cache_required");
      const cacheDir = dir || path.join(root, "cache/base-release/wheels");
      for (const name of group.files) {
        const row = lock.groups[group.group].find((r) => r.filename === name);
        check(row, row, "missing_artifact_pin");
        const file = path.join(cacheDir, name);
        if (verify) {
          const stat = await lstat(file);
          check(
            stat,
            stat.isFile() &&
              !stat.isSymbolicLink() &&
              stat.size === row.bytes &&
              digest(await readFile(file)) === row.sha256,
            "artifact_pin_mismatch",
          );
        }
        rows.push({
          path: file,
          sha256: row.sha256,
          bytes: row.bytes,
          package: row.package,
          version: row.version,
        });
      }
    }
    return rows;
  }
  async function prepare(item, action = "install") {
    if (action === "setup-hermes") {
      check(
        item,
        item.componentId === "hermes" && item.mode === "install",
        "managed_hermes_required",
      );
      const prepared =
        item.config.providerId === "llamacpp"
          ? await modelManager.prepareLocal(item, { prepareAPI: true })
          : await modelManager.prepareBackend(item);
      return {
        ...prepared,
        effects: [
          "Configure the private Hermes API and chosen model, then start this instance. A running instance is stopped first. No page or conversation content is sent during setup; any synthetic local-server readiness probe is disclosed below.",
          ...prepared.effects,
        ],
      };
    }
    if (action === "setup-local-model") return modelManager.prepareLocal(item);
    if (
      ["configure", "configure-backend"].includes(action) &&
      item.componentId === "hermes" &&
      item.config.providerId
    )
      return modelManager.prepareBackend(item);
    if (action === "enable-network") return network.prepare(item);
    if (item.mode === "connect") {
      endpoint(item.config.endpoint);
      return {
        artifacts: [],
        prerequisites: [],
        effects: [
          "Register an external connection; no process control or data adoption.",
        ],
      };
    }
    if (item.mode === "vps") return vps.prepare(item);
    if (
      item.componentId === "matrix" &&
      ["prepare-artifacts", "install", "resume-install"].includes(action) &&
      !env.ZENITH_SETUP_MATRIX_WHEELHOUSE
    )
      return matrix.prepare(item, action);
    if (
      item.descriptor.adapter === "hermes" &&
      ["install", "resume-install"].includes(action)
    )
      return hermes.prepare(item);
    const base = await pythonPreflight(python, run);
    const prerequisites = [...base.prerequisites];
    let artifacts = [];
    if (!["install", "resume-install"].includes(action))
      return {
        artifacts: [],
        prerequisites: [],
        effects: [
          action === "stop"
            ? "Stop only this owned instance; retain all data."
            : action === "start"
              ? "Launch only this configured instance."
              : "Configure the selected instance; retain identity and data.",
        ],
      };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      prerequisites.push(
        "This native artifact closure supports Apple silicon macOS.",
      );
    if (item.mode === "vps")
      prerequisites.push(
        "Select an owner-configured VPS target and its verified Linux artifact closure.",
      );
    try {
      await access(python);
      artifacts = await filesFor(item, { verify: false });
      if (item.descriptor.artifacts.some((a) => a.group === "matrix"))
        artifacts = await filesFor(item);
    } catch (e) {
      prerequisites.push(
        e.code === "artifact_pin_mismatch"
          ? "Artifact cache differs from reviewed hashes."
          : "Owner must prepare the pinned component artifact cache.",
      );
    }
    if (!item.descriptor.artifacts.length)
      prerequisites.push(
        "Owner must configure a qualified source-build or release adapter for this component; existing connections are supported.",
      );
    if (item.componentId === "matrix" && item.config.access !== "private")
      prerequisites.push(
        "Public TLS and DNS delegation must be configured and verified before public access.",
      );
    if (item.config.domainMode === "managed")
      prerequisites.push(
        "Managed Zenith subdomain reservation must be supplied by the domain operator.",
      );

    return {
      artifacts,
      bootstrap: base.bootstrap,
      prerequisites,
      effects: [
        "Install only the disclosed package closure in a private per-instance Python environment.",
        "Configuration and start require separate reviewed actions.",
      ],
    };
  }
  async function install(plan) {
    if (plan.mode === "vps") return vps.execute(plan, "install");
    if (plan.descriptor.adapter === "hermes") return hermes.install(plan);
    check(plan, plan.prerequisites.length === 0, "unmet_prerequisites");
    await verifyExecutable(plan.bootstrap);
    try {
      await filesFor(plan);
    } catch (error) {
      if (
        plan.descriptor.artifacts.some((a) => a.group !== "base") ||
        env.ZENITH_SETUP_BASE_WHEELHOUSE
      )
        throw error;
      const { mkdir, copyFile } = await import("node:fs/promises");
      const cache = path.join(root, "cache/installers");
      await mkdir(cache, { recursive: true, mode: 0o700 });
      const result = JSON.parse(
        await run(python, [
          "-I",
          "-S",
          "-B",
          path.join(
            process.cwd(),
            "profiles/process-macos/installer_bundle.py",
          ),
          "--descriptor",
          path.join(process.cwd(), "profiles/process-macos/installer.v1.json"),
          "--cache",
          cache,
        ]),
      );
      const wheels = path.join(root, "cache/base-release/wheels");
      await mkdir(wheels, { recursive: true, mode: 0o700 });
      for (const f of plan.artifacts)
        await copyFile(
          path.join(result.bundle, "wheels", path.basename(f.path)),
          f.path,
        );
      await filesFor(plan);
    }
    return run(
      python,
      ["-I", "-B", script, "install", "--plan", plan.planFile],
      {
        logFile: path.join(
          root,
          "logs",
          path.basename(plan.planFile) + ".install.log",
        ),
      },
    );
  }
  async function configure(plan) {
    if (plan.mode === "vps") return vps.execute(plan, "configure");
    if (plan.descriptor.adapter === "hermes") return hermes.configure(plan);
    return run(
      python,
      ["-I", "-B", script, "configure", "--plan", plan.planFile],
      {
        logFile: path.join(
          root,
          "logs",
          path.basename(plan.planFile) + ".configure.log",
        ),
      },
    );
  }
  async function lifecycle(plan, action) {
    if (plan.mode === "vps") return vps.execute(plan, action);
    const launcher =
      plan.componentId === "hermes"
        ? await hermes.lifecyclePython(plan)
        : python;
    return run(
      launcher,
      ["-I", "-B", script, action, "--plan", plan.planFile],
      {
        timeout: 35000,
        ...(action === "status"
          ? {}
          : {
              logFile: path.join(
                root,
                "logs",
                path.basename(plan.planFile) + "." + action + ".log",
              ),
            }),
      },
    );
  }
  async function waitForHermes(plan) {
    const deadline = Date.now() + 120000;
    do {
      try {
        const observation = await netProbe(
          "hermes",
          "http://127.0.0.1:" + plan.config.port,
          { token: await hermes.token(plan) },
        );
        if (observation.reachable && observation.chatAvailable) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    check(plan, false, "hermes_api_startup_failed_check_configuration");
  }
  async function secret(config) {
    if (!config.secretRef) return undefined;
    const file = env.ZENITH_SETUP_SECRETS_FILE;
    check(file, !!file, "secret_not_configured");
    const map = JSON.parse(await readPrivate(file));
    const ref = map[config.secretRef];
    check(
      ref,
      typeof ref === "string" && path.isAbsolute(ref),
      "secret_not_configured",
    );
    return (await readPrivate(ref, 4096)).trim();
  }
  async function token(item) {
    if(item.componentId==="matrix"){const session=await readMatrixSession(root,item);if(session)return session.token;}
    return item.componentId === "hermes" && item.mode !== "connect"
      ? hermes.token(item)
      : secret(item.config);
  }
  return {
    prepare,
    async configurationActive(item) {
      try {
        const marker=JSON.parse(await readPrivate(path.join(item.root,"config/configuration-lock.json")));
        check(marker,marker.schema==="zenith.hub-configure-lock.v1"&&marker.root===item.root&&marker.instanceId===item.instanceId&&Number.isSafeInteger(marker.pid)&&marker.pid>0,"matrix_configuration_lock_unresolved");
        const result=spawnSync("/bin/ps",["-p",String(marker.pid),"-o","lstart=,comm="],{encoding:"utf8",timeout:5000});
        if(result.error)return null;
        if(result.status===1)return false;
        if(result.status!==0||!result.stdout.trim())return null;
        return result.stdout.trim()===marker.processStamp;
      } catch(error) { if(error.code==="ENOENT")return false;throw error; }
    },
    async installerActive(marker, instanceRoot) {
      if (
        !Number.isSafeInteger(marker.installerPid) ||
        !marker.installerStarted
      )
        return null;
      try {
        const cmd = await run("/bin/ps", [
          "-ww",
          "-p",
          String(marker.installerPid),
          "-o",
          "command=",
        ]);
        const started = (
          await run("/bin/ps", [
            "-p",
            String(marker.installerPid),
            "-o",
            "lstart=",
          ])
        ).trim();
        return (
          cmd.includes("hermes-install.py") &&
          cmd.includes(path.dirname(path.dirname(instanceRoot))) &&
          started === marker.installerStarted
        );
      } catch {
        return false;
      }
    },
    modelRequest: (item, body) => modelManager.request(item, body),
    "setup-local-model": (plan) => modelManager.setupLocal(plan),
    async setupHermes(plan, checkpoint) {
      const running = JSON.parse(await lifecycle(plan, "status")).running;
      check(
        running,
        typeof running === "boolean",
        "process_state_unknown_reconcile",
      );
      if (running) {
        await checkpoint("stopping");
        await lifecycle(plan, "stop");
      }
      await checkpoint("configuring");
      let config = plan.config;
      if (config.providerId === "llamacpp") {
        const receipt = JSON.parse(
          await readPrivate(path.join(plan.root, "receipt.json")),
        );
        if (!receipt.configured)
          await hermes.configure({ ...plan, config: { port: config.port } });
        await checkpoint("preparing-model");
        const result = await modelManager.setupLocal(plan);
        config = { ...config, ...result.backend };
      } else await hermes.configure(plan);
      await checkpoint("starting", config);
      await portAvailable(config.port);
      await lifecycle({ ...plan, config }, "start");
      await checkpoint("checking-api", config);
      await waitForHermes({ ...plan, config });
      await checkpoint("started", config);
      return { backend: config };
    },
    installations: () => installations.public(),
    prepareGuideProfile: (item, options) =>
      installations.prepare(item, options),
    "create-guide-profile": (p) => installations.create(p),
    "prepare-artifacts": (p) => matrix.execute(p),
    install,
    configure,
    token,
    "enable-network": (p) => network.enable(p),
    backup: (p) => lifecycle(p, "backup"),
    status: async (p) => JSON.parse(await lifecycle(p, "status")).running,
    start: async (p) => {
      const result = await lifecycle(p, "start");
      if (p.componentId === "hermes") await waitForHermes(p);
      return result;
    },
    stop: (p) => lifecycle(p, "stop"),
    filesFor,
    async observe(item) {
      if (item.componentId === "frank")
        return {
          observedAt: new Date().toISOString(),
          reachable: null,
          applicationReady: false,
          permission: "not-configured",
          contract: "not-tested",
          error: null,
        };
      const base =
        item.mode === "connect"
          ? item.config.endpoint
          : "http://127.0.0.1:" + item.config.port;
      return netProbe(item.componentId, base, {
        token: await token(item).catch(() => undefined),
        allowPrivateHosts: (env.ZENITH_SETUP_PRIVATE_HOSTS || "")
          .split(",")
          .filter(Boolean),
      });
    },
    secret,
  };
}
