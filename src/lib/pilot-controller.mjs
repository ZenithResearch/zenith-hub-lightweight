/** Fixed local owner actions. Browser input never selects a path, executable or scope. */
import { executeOwned } from "./owned-process.mjs";
import { randomBytes, createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const controller = path.join(
  process.cwd(),
  "profiles/process-macos/process_mac.py",
);
const pilotActions = new Set(["pilot-setup", "pilot-initialize", "pilot-next", "pilot-inspect",
  "pilot-resume", "pilot-renew", "pilot-export"]);
const actions = new Set(["status", "doctor", "install", "start", "stop", ...pilotActions]);
const hex = () => randomBytes(24).toString("hex");
export class OperatorError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new OperatorError(code, status);
};
const closed = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    fail("invalid_request");
};
export function createController({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  run = executeOwned,
  clock = Date.now,
} = {}) {
  const origin = env.ZENITH_OPERATOR_ORIGIN || "http://127.0.0.1:4208";
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port
  )
    fail("invalid_operator_origin");
  const enabled =
    env.ZENITH_LOCAL_OPERATOR === "1" &&
    platform === "darwin" &&
    arch === "arm64";
  const selectedProfile = env.ZENITH_PROCESS_PROFILE || "installation";
  if (!["installation", "local-review"].includes(selectedProfile)) fail("invalid_profile");
  const pilot = selectedProfile === "local-review";
  const root = path.resolve(
    /* turbopackIgnore: true */ env.ZENITH_PROCESS_ROOT ||
      path.join(os.homedir(), "Library/Application Support/Zenith", pilot ? "Process-Pilot" : "Process"),
  );
  const python = env.ZENITH_PROCESS_PYTHON || "/opt/homebrew/bin/python3.12";
  if (!path.isAbsolute(python)) fail("invalid_interpreter");
  const bundle = env.ZENITH_PROCESS_BUNDLE
    ? path.resolve(/* turbopackIgnore: true */ env.ZENITH_PROCESS_BUNDLE)
    : null;
  const ports = {
    runtime: Number(env.ZENITH_RUNTIME_PORT || (pilot ? 8192 : 8092)),
    service: Number(env.ZENITH_SERVICE_PORT || (pilot ? 8191 : 8091)),
  };
  if (
    Object.values(ports).some(
      (p) => !Number.isInteger(p) || p < 1024 || p > 65535,
    ) ||
    ports.runtime === ports.service
  )
    fail("invalid_ports");
  if (pilot && (path.basename(root) !== "Process-Pilot" || ports.runtime !== 8192 || ports.service !== 8191))
    fail("invalid_pilot_target");
  const csrf = hex(),
    plans = new Map();
  let busy = false,
    blocked = false;
  function admit(request, mutation = false) {
    if (!enabled) fail("local_operator_disabled", 403);
    if (
      request.headers.get("host") !== url.host ||
      new URL(request.url).origin !== origin
    )
      fail("wrong_host", 403);
    const supplied = request.headers.get("origin"),
      site = request.headers.get("sec-fetch-site");
    if (
      (supplied && supplied !== origin) ||
      (site && !["same-origin", "none"].includes(site))
    )
      fail("wrong_origin", 403);
    if (
      mutation &&
      (supplied !== origin ||
        request.headers.get("content-type") !== "application/json" ||
        request.headers.get("x-zenith-csrf") !== csrf)
    )
      fail("cross_site_action", 403);
  }
  async function identity() {
    try {
      const m = await lstat(root);
      if (!m.isDirectory() || m.isSymbolicLink()) fail("unsafe_target");
      return { exists: true, device: m.dev, inode: m.ino };
    } catch (e) {
      if (e.code === "ENOENT") return { exists: false };
      throw e;
    }
  }
  async function release() {
    if (!bundle) return null;
    const m = await lstat(bundle);
    if (!m.isDirectory() || m.isSymbolicLink()) fail("unsafe_bundle");
    const manifest = path.join(bundle, "bundle.json"),
      profile = path.join(bundle, "profile.json");
    for (const file of [manifest, profile]) {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
        fail("invalid_bundle");
    }
    const bytes = await readFile(manifest);
    const supplied = await readFile(profile),
      pinned = await readFile(
        path.join(process.cwd(), "profiles/process-macos", pilot ? "release.local-review.v1.json" : "release.v1.json"),
      );
    if (!supplied.equals(pinned)) fail("unrecognized_release", 409);
    if (bytes.length > 65536) fail("invalid_bundle");
    return createHash("sha256").update(bytes).digest("hex");
  }
  async function pilotBinding() {
    if (!pilot || !(await identity()).exists) return null;
    const files = {};
    for (const name of ["config/pilot-controller.json", "config/pilot-setup-plan.json",
      "config/pilot-workflow.json", "authority/COMPLETE.json",
      "authority/config/frank-local-review.json", "authority/config/runtime-receiver.json",
      "authority/config/runtime-policy.json", "authority/config/wallet-command.json",
      "authority/config/command-authority.json", "authority/config/result-authority.json",
      "authority/config/result-policy.json", "config/runtime-admission.json",
      "data/pilot-operation.json", "data/frank-local-review-cleanup.json"]) {
      const file = path.join(root, name);
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536 ||
            info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.nlink !== 1)
          fail("unsafe_pilot_configuration", 409);
        const bytes = await readFile(file);
        if (bytes.length !== info.size) fail("pilot_configuration_changed", 409);
        files[name] = createHash("sha256").update(bytes).digest("hex");
      } catch (error) {
        if (error.code === "ENOENT") files[name] = null;
        else return {digest: null, selection: null, quarantined: true};
      }
    }
    return { digest: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
      selection: files["config/pilot-controller.json"],
      quarantined: Boolean(files["data/pilot-operation.json"] || files["data/frank-local-review-cleanup.json"]),
    };
  }
  function available(status, binding) {
    if (!status?.installed) return [];
    const running = status.components.some((c) => c.managed === true);
    const result = ["doctor", running ? "stop" : "start"];
    if (!pilot) return result;
    if (binding?.quarantined || status.pilot?.cleanup_unresolved) return ["doctor", ...(running ? ["stop"] : [])];
    if (!binding?.selection) return ["doctor", ...(running ? ["stop"] : [])];
    if (status.pilot?.setup === "absent") return [...result.filter((a) => a !== "start"), "pilot-setup"];
    if (status.pilot?.setup !== "configured") return ["doctor", ...(running ? ["stop"] : [])];
    if (!running || status.pilot?.workflow_selected !== true) return result;
    result.push("pilot-inspect", "pilot-initialize", "pilot-next");
    if (status.pilot?.workflow?.recoverable === true) result.push("pilot-resume", "pilot-renew");
    if (status.pilot?.workflow?.export_available === true) result.push("pilot-export");
    return result;
  }
  async function invoke(action, digest = null, binding = null) {
    if (blocked) fail("controller_cleanup_unresolved", 503);
    const args = ["-I", "-S", "-B", controller, action, "--root", root];
    if (pilot && binding?.selection && (pilotActions.has(action) || action === "start"))
      args.push("--selection-sha256", binding.selection);
    if (action === "install") {
      if (!bundle || !digest) fail("bundle_not_configured");
      args.push(
        "--bundle",
        bundle,
        "--bundle-sha256",
        digest,
        "--runtime-port",
        String(ports.runtime),
        "--service-port",
        String(ports.service),
      );
    }
    try {
      const result = await run(python, args, {
        timeout:
          action === "install" ? 240000 : action === "stop" ? 120000 :
          pilot && (pilotActions.has(action) || action === "start") ? 240000 : 90000,
        maxBuffer: 262144,
        env: {
          HOME: os.homedir(),
          PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
          TMPDIR: os.tmpdir(),
        },
        shell: false,
      });
      return JSON.parse(result.stdout);
    } catch (error) {
      if (error.code === "OPERATOR_CLEANUP_UNRESOLVED") {
        blocked = true;
        fail("controller_cleanup_unresolved", 503);
      }
      fail("controller_rejected", 422);
    }
  }
  function project(report) {
    const component = (name) => {
      const v = report?.components?.[name];
      return {
        name,
        live: typeof v?.live === "boolean" ? v.live : null,
        ready: typeof v?.ready === "boolean" ? v.ready : null,
        managed: typeof v?.managed === "boolean" ? v.managed : null,
      };
    };
    return {
      installed: report?.installed === true,
      authority: report?.authority === "pending" ? "pending" : "unknown",
      pilot_ready: report?.pilot_ready === true,
      external_effects: report?.external_effects === true,
      pilot: pilot ? {
        setup: ["not_selected", "absent", "partial", "configured"].includes(report?.pilot?.setup)
          ? report.pilot.setup : "unknown",
        cleanup_unresolved: report?.pilot?.cleanup_unresolved === true,
        workflow_selected: report?.pilot?.workflow_selected === true,
        workflow: report?.pilot?.workflow ? {
          observed_at: Number.isSafeInteger(report.pilot.workflow.observed_at) ? report.pilot.workflow.observed_at : null,
          run_state: typeof report.pilot.workflow.run_state === "string" ? report.pilot.workflow.run_state.slice(0, 64) : "unknown",
          recoverable: report.pilot.workflow.recoverable === true,
          export_available: report.pilot.workflow.export_available === true,
        } : null,
      } : null,
      actor_count: Number.isSafeInteger(report?.frank?.actor_count)
        ? report.frank.actor_count
        : null,
      components: ["service", "runtime"].map(component),
    };
  }
  async function state() {
    const id = await identity();
    if (!id.exists)
      return {
        installed: false,
        authority: "unknown",
        pilot_ready: false,
        external_effects: false,
        actor_count: null,
        components: [],
      };
    return project(await invoke("status"));
  }
  return {
    enabled,
    async get(request) {
      if (!enabled)
        return {
          schema: "zenith.deployer.v1",
          mode: "disabled",
          reason: "Run the local operator launcher on an Apple silicon Mac.",
          profile: pilot ? "local-review-v1" : "process-macos-v1",
        };
      admit(request);
      const status = busy || blocked ? null : await state();
      const binding = busy || blocked ? null : await pilotBinding();
      return {
        schema: "zenith.deployer.v1",
        mode: "local",
        profile: pilot ? "local-review-v1" : "process-macos-v1",
        target: root,
        release_digest: await release(),
        csrf,
        busy: busy || blocked,
        status,
        actions: busy || blocked ? [] : status?.installed ? available(status, binding)
          : (await identity()).exists ? [] : bundle ? ["install"] : [],
      };
    },
    admitMutation(request) {
      admit(request, true);
    },
    async post(request, body) {
      admit(request, true);
      if (busy || blocked) fail("operation_in_progress", 409);
      if (body?.operation === "plan") {
        closed(body, ["schema", "operation", "action"]);
        if (
          body.schema !== "zenith.deployer-action.v1" ||
          !actions.has(body.action) ||
          body.action === "status" || (!pilot && pilotActions.has(body.action))
        )
          fail("invalid_action");
        for (const [id, p] of plans) if (clock() > p.expires) plans.delete(id);
        if (plans.size >= 8) fail("too_many_plans", 429);
        const current = await identity(),
          digest = await release(),
          binding = await pilotBinding();
        if (body.action === "install" && (current.exists || !digest))
          fail(current.exists ? "target_exists" : "bundle_not_configured", 409);
        if (body.action !== "install" && !current.exists)
          fail("not_installed", 409);
        if (pilot && !["install", "doctor", "stop"].includes(body.action) && !available(await state(), binding).includes(body.action))
          fail("pilot_action_unavailable", 409);
        if (plans.size >= 8) fail("too_many_plans", 429);
        const plan = {
          id: hex(),
          action: body.action,
          target: root,
          release_digest: digest,
          expires: clock() + 60000,
          identity: current,
          configuration: binding,
        };
        plans.set(plan.id, plan);
        return {
          schema: "zenith.deployer-plan.v1",
          plan: {
            id: plan.id,
            action: plan.action,
            target: root,
            release_digest: digest,
            expires_at: plan.expires,
            configuration_digest: binding?.digest || null,
            detail:
              pilotActions.has(body.action)
                ? ({"pilot-setup": "Create the finite owner-selected native pilot custody once; retain partial failures.",
                    "pilot-initialize": "Publish the pinned review process, upload its declared inputs, register Frank and create the selected run.",
                    "pilot-next": "Execute currently eligible work for the selected local review; keep external effects disabled.",
                    "pilot-inspect": "Read the selected Runtime run and receipts; retain an observation with its time.",
                    "pilot-resume": "Resume the exact retained unresolved work; do not rerun captured computation.",
                    "pilot-renew": "Explicitly renew the retained result attestation without rerunning its provider.",
                    "pilot-export": "Export committed local-review Markdown to this installation’s fixed export directory."})[body.action]
              : body.action === "install"
                ? "Install the pinned base stack. Native authority and providers remain disabled."
                : body.action === "stop"
                  ? "Stop only this installation’s Service and Runtime; preserve its data."
                  : body.action === "start"
                    ? pilot ? "Start this isolated Runtime with its current receiver and finite new-run policy; Service stays default deny."
                      : "Start this installation’s Service and Runtime with default-deny authority."
                    : "Inspect installation integrity and readiness; do not activate providers.",
          },
        };
      }
      closed(body, ["schema", "operation", "plan_id"]);
      if (
        body.schema !== "zenith.deployer-action.v1" ||
        body.operation !== "apply"
      )
        fail("invalid_request");
      const plan = plans.get(body.plan_id);
      if (!plan) fail("unknown_plan", 409);
      plans.delete(body.plan_id);
      busy = true;
      try {
        const status = pilot && !["install", "doctor", "stop"].includes(plan.action) ? await state() : null;
        const current = await identity(),
          digest = await release(),
          binding = await pilotBinding();
        if (
          clock() >= plan.expires ||
          JSON.stringify(current) !== JSON.stringify(plan.identity) ||
          digest !== plan.release_digest ||
          JSON.stringify(binding) !== JSON.stringify(plan.configuration)
        )
          fail("plan_changed_or_expired", 409);
        if (pilot && !["install", "doctor", "stop"].includes(plan.action) && !available(status, binding).includes(plan.action))
          fail("pilot_action_unavailable", 409);
        await invoke(plan.action, plan.release_digest, binding);
        return {
          schema: "zenith.deployer-result.v1",
          action: plan.action,
          applied: true,
          status: await state(),
        };
      } finally {
        busy = blocked;
      }
    },
  };
}
