/** Local owner operations only. No native identity provisioning or arbitrary executable/path input. */
import { executeOwned } from "./owned-process.mjs";
import { randomBytes, createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const controller = path.join(
  process.cwd(),
  "profiles/process-macos/process_mac.py",
);
const actions = new Set(["status", "doctor", "install", "start", "stop"]);
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
  const root = path.resolve(
    /* turbopackIgnore: true */ env.ZENITH_PROCESS_ROOT ||
      path.join(os.homedir(), "Library/Application Support/Zenith/Process"),
  );
  const python = env.ZENITH_PROCESS_PYTHON || "/opt/homebrew/bin/python3.12";
  if (!path.isAbsolute(python)) fail("invalid_interpreter");
  const bundle = env.ZENITH_PROCESS_BUNDLE
    ? path.resolve(/* turbopackIgnore: true */ env.ZENITH_PROCESS_BUNDLE)
    : null;
  const ports = {
    runtime: Number(env.ZENITH_RUNTIME_PORT || 8092),
    service: Number(env.ZENITH_SERVICE_PORT || 8091),
  };
  if (
    Object.values(ports).some(
      (p) => !Number.isInteger(p) || p < 1024 || p > 65535,
    ) ||
    ports.runtime === ports.service
  )
    fail("invalid_ports");
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
        path.join(process.cwd(), "profiles/process-macos/release.v1.json"),
      );
    if (!supplied.equals(pinned)) fail("unrecognized_release", 409);
    if (bytes.length > 65536) fail("invalid_bundle");
    return createHash("sha256").update(bytes).digest("hex");
  }
  async function invoke(action, digest = null) {
    if (blocked) fail("controller_cleanup_unresolved", 503);
    const args = ["-I", "-S", "-B", controller, action, "--root", root];
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
          action === "install" ? 240000 : action === "stop" ? 120000 : 90000,
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
          profile: "process-macos-v1",
        };
      admit(request);
      const status = busy || blocked ? null : await state();
      return {
        schema: "zenith.deployer.v1",
        mode: "local",
        profile: "process-macos-v1",
        target: root,
        release_digest: await release(),
        csrf,
        busy: busy || blocked,
        status,
        actions:
          busy || blocked
            ? []
            : status?.installed
              ? [
                  "doctor",
                  status.components.some((c) => c.managed === true)
                    ? "stop"
                    : "start",
                ]
              : (await identity()).exists
                ? []
                : bundle
                  ? ["install"]
                  : [],
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
          body.action === "status"
        )
          fail("invalid_action");
        for (const [id, p] of plans) if (clock() > p.expires) plans.delete(id);
        if (plans.size >= 8) fail("too_many_plans", 429);
        const current = await identity(),
          digest = await release();
        if (body.action === "install" && (current.exists || !digest))
          fail(current.exists ? "target_exists" : "bundle_not_configured", 409);
        if (body.action !== "install" && !current.exists)
          fail("not_installed", 409);
        if (plans.size >= 8) fail("too_many_plans", 429);
        const plan = {
          id: hex(),
          action: body.action,
          target: root,
          release_digest: digest,
          expires: clock() + 60000,
          identity: current,
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
            detail:
              body.action === "install"
                ? "Install the pinned base stack. Native authority and providers remain disabled."
                : body.action === "stop"
                  ? "Stop only this installation’s Service and Runtime; preserve its data."
                  : body.action === "start"
                    ? "Start this installation’s Service and Runtime with default-deny authority."
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
        const current = await identity(),
          digest = await release();
        if (
          clock() >= plan.expires ||
          JSON.stringify(current) !== JSON.stringify(plan.identity) ||
          digest !== plan.release_digest
        )
          fail("plan_changed_or_expired", 409);
        await invoke(plan.action, plan.release_digest);
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
