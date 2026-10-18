/** Workspace bridge: Runtime owns business data; only reviewed fixed owner commands cross this boundary. */
import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { executeOwned } from "./owned-process.mjs";
import { OperatorError } from "./pilot-controller.mjs";
const fail = (code, status = 400) => { throw new OperatorError(code, status); };
const token = () => randomBytes(24).toString("hex");
const digest = (s) => createHash("sha256").update(s).digest("hex");
const id = (s) => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(s);
const version = (v) => Number.isSafeInteger(v) && v > 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const closed = (v, keys) => { if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)))
    fail("invalid_payload"); };
export function canonical(value, depth = 0) {
    if (depth > 24)
        fail("invalid_payload");
    if (value === null || typeof value === "boolean" || typeof value === "string")
        return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(v => canonical(v, depth + 1)).join(",") + "]";
    if (object(value) && Object.getPrototypeOf(value) === Object.prototype)
        return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k], depth + 1)).join(",") + "}";
    fail("invalid_payload");
}
const cliActions = new Set(["catalog", "get", "validate", "draft-put", "publish", "resume-command"]);
const lifecycle = new Set(["workspace-prepare", "workspace-setup", "workspace-start", "workspace-stop"]);
function validatePayload(action, p) {
    if (!object(p))
        fail("invalid_payload");
    if (action === "catalog") {
        closed(p, ["after", "limit", "max_pages"]);
        if (!Number.isSafeInteger(p.after) || p.after < 0 || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 100 || !Number.isInteger(p.max_pages) || p.max_pages < 1 || p.max_pages > 20)
            fail("invalid_payload");
    }
    else if (action === "get") {
        closed(p, ["process_id"]);
        if (!id(p.process_id))
            fail("invalid_payload");
    }
    else if (action === "resume-command") {
        closed(p, ["request_id"]);
        if (!id(p.request_id))
            fail("invalid_payload");
    }
    else if (action === "validate") {
        if (p.schema !== "process.draft.v1" || !id(p.process_id) || !Array.isArray(p.steps))
            fail("invalid_payload");
    }
    else {
        closed(p, ["schema", "operation", "request_id", "resource", "expected_version", "payload"]);
        if (p.schema !== "runtime.command.v1" || !id(p.request_id) || p.operation !== (action === "publish" ? "process.publish" : "process.draft.put") || !object(p.payload))
            fail("invalid_payload");
        if (action === "draft-put") {
            closed(p.payload, ["draft", "provenance"]);
            if (p.expected_version !== null && !version(p.expected_version))
                fail("invalid_payload");
            if (p.payload.draft?.schema !== "process.draft.v1" || !id(p.payload.draft.process_id) || p.resource !== "processes/" + p.payload.draft.process_id)
                fail("invalid_payload");
        }
        else {
            closed(p.payload, ["process_id", "draft_revision", "version_id"]);
            if (!version(p.expected_version) || !version(p.payload.draft_revision) || !id(p.payload.process_id) || !id(p.payload.version_id) || p.resource !== "processes/" + p.payload.process_id)
                fail("invalid_payload");
        }
    }
}
function projectProcess(p) {
    if (!object(p) || !id(p.process_id))
        return null;
    return { process_id: p.process_id, version: version(p.version) ? p.version : null, revision: version(p.revision) ? p.revision : null, draft: object(p.draft) ? p.draft : null, provenance: object(p.provenance) ? p.provenance : null, last_ordinal: Number.isSafeInteger(p.last_ordinal) ? p.last_ordinal : null, active_version: object(p.active_version) ? { process_id: p.active_version.process_id, process_version: p.active_version.process_version, compilation_hash: p.active_version.compilation_hash } : null };
}
function projectResult(r, action, payload) {
    if (["draft-put", "publish"].includes(action) && (r?.request_id !== payload.request_id || r?.operation !== payload.operation || r?.resource !== payload.resource || !version(r?.version)))
        fail("workspace_result_binding_changed", 502);
    if (action === "resume-command" && (r?.request_id !== payload.request_id || !version(r?.version)))
        fail("workspace_result_binding_changed", 502);
    if (action === "catalog" && r?.schema === "frank.workspace.catalog.v1")
        return { schema: r.schema, process_ids: Array.isArray(r.process_ids) ? r.process_ids.filter(id).slice(0, 2000) : [], after: r.after, next_cursor: r.next_cursor, high_watermark: r.high_watermark, cursor_exhausted: r.cursor_exhausted === true, complete: r.after === 0 && r.cursor_exhausted === true && r.complete === true };
    if (action === "get" && r?.schema === "frank.workspace.process.v1")
        return { schema: r.schema, process: projectProcess(r.process) };
    if (action === "validate" && r?.schema === "frank.workspace.validation.v1")
        return { schema: r.schema, valid: r.valid === true, compilation_hash: typeof r.compilation_hash === "string" ? r.compilation_hash : null, code: typeof r.code === "string" ? r.code.slice(0, 64) : null, detail: typeof r.detail === "string" ? r.detail.slice(0, 512) : null };
    if (["draft-put", "publish", "resume-command"].includes(action) && r?.schema === "runtime.result.v1" && ["process.draft.put", "process.publish"].includes(r.operation))
        return { schema: r.schema, operation: r.operation, request_id: r.request_id, duplicate: r.duplicate === true, resource: r.resource, version: r.version, result: object(r.result) ? Object.fromEntries(["process_id", "revision", "draft", "provenance", "last_ordinal", "active_version", "pin", "ordinal", "source_revision", "published_at_ms", "source_draft"].filter(k => Object.hasOwn(r.result, k)).map(k => [k, r.result[k]])) : null };
    fail("unsupported_workspace_result", 502);
}
export function createWorkspaceController({ env = process.env, platform = process.platform, arch = process.arch, run = executeOwned, clock = Date.now } = {}) {
    const origin = env.ZENITH_OPERATOR_ORIGIN || "http://127.0.0.1:4208", url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
        fail("invalid_operator_origin");
    const enabled = env.ZENITH_LOCAL_OPERATOR === "1" && env.ZENITH_PROCESS_PROFILE === "workspace" && platform === "darwin" && arch === "arm64";
    const root = path.resolve(env.ZENITH_PROCESS_ROOT || path.join(os.homedir(), "Library/Application Support/Zenith/Process-Workspace"));
    const python = env.ZENITH_PROCESS_PYTHON || "/opt/homebrew/bin/python3.12";
    if (!path.isAbsolute(python))
        fail("invalid_interpreter");
    if (enabled && (path.basename(root) !== "Process-Workspace" || Number(env.ZENITH_RUNTIME_PORT || 8292) !== 8292 || Number(env.ZENITH_SERVICE_PORT || 8291) !== 8291))
        fail("invalid_workspace_target");
    const controller = path.join(process.cwd(), "profiles/process-macos/process_mac.py"), csrf = token(), plans = new Map();
    let busy = false, blocked = false;
    function admit(req, mutation = false) {
        if (!enabled)
            fail("workspace_disabled", 403);
        if (req.headers.get("host") !== url.host || new URL(req.url).origin !== origin)
            fail("wrong_host", 403);
        const from = req.headers.get("origin"), site = req.headers.get("sec-fetch-site");
        if ((from && from !== origin) || (site && !["same-origin", "none"].includes(site)))
            fail("wrong_origin", 403);
        if (mutation && (from !== origin || req.headers.get("content-type") !== "application/json" || req.headers.get("x-zenith-csrf") !== csrf))
            fail("cross_site_action", 403);
    }
    async function binding() {
        let stat;
        try {
            stat = await lstat(root);
        }
        catch (e) {
            if (e.code === "ENOENT")
                return { identity: null, files: {}, digest: null, selection: null };
            throw e;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink())
            fail("unsafe_target", 409);
        const files = {};
        let setup = null;
        for (const name of ["logs/workspace-operation.json", "data/frank-workspace-cleanup.json", "config/workspace-setup-plan.json", "config/frank-workspace.json", "config/workspace-admission.json", "authority/COMPLETE.json", "authority/config/wallet-command.json", "authority/config/runtime-policy.json", "authority/config/runtime-receiver.json", "authority/config/command-authority.json"]) {
            try {
                const file = path.join(root, name), m = await lstat(file);
                if (!m.isFile() || m.isSymbolicLink() || m.nlink !== 1 || m.uid !== process.getuid() || (m.mode & 0o777) !== 0o600 || m.size > 65536)
                    fail("unsafe_workspace_configuration", 409);
                const bytes = await readFile(file);
                if (bytes.length !== m.size)
                    fail("workspace_configuration_changed", 409);
                files[name] = digest(bytes);
                if (name === "config/workspace-setup-plan.json") {
                    try {
                        const p = JSON.parse(bytes.toString("utf8"));
                        closed(p, ["schema", "workspace_root", "not_before", "not_after", "identity_not_after", "wallet_command_sha256", "verifier_sha256"]);
                        const times = [p.not_before, p.not_after, p.identity_not_after];
                        const canonicalTime = t => typeof t === "string" && /^[1-9][0-9]*(?![\s\S])/.test(t) && Number.isSafeInteger(Number(t));
                        const validPin = pin => typeof pin === "string" && /^[a-f0-9]{64}(?![\s\S])/.test(pin);
                        if (p.schema === "castalia.wallet-workspace-setup.v1" && p.workspace_root === root && times.every(canonicalTime) && Number(p.not_before) < Number(p.not_after) && Number(p.not_after) - Number(p.not_before) <= 3600 && Number(p.identity_not_after) >= Number(p.not_after) && Number(p.identity_not_after) - Number(p.not_before) <= 31536000 && validPin(p.wallet_command_sha256) && validPin(p.verifier_sha256))
                            setup = { not_before: p.not_before, not_after: p.not_after, identity_not_after: p.identity_not_after, scope: "process.draft.put / process.publish / process.get: processes/; version.get: versions/; events.list: events. No run execution or providers." };
                    }
                    catch {
                        setup = null;
                    }
                }
            }
            catch (e) {
                if (e.code === "ENOENT")
                    files[name] = null;
                else
                    throw e;
            }
        }
        return { identity: { device: stat.dev, inode: stat.ino }, files, digest: digest(canonical(files)), setup, selection: files["config/workspace-setup-plan.json"] };
    }
    async function invoke(action, request = null, selection = null) {
        if (blocked)
            fail("controller_cleanup_unresolved", 503);
        const args = ["-I", "-S", "-B", controller, action, "--root", root];
        if (action === "workspace-setup" && !selection)
            fail("workspace_setup_not_selected", 409);
        if (["workspace-prepare", "workspace-setup"].includes(action) && selection)
            args.push("--selection-sha256", selection);
        if (request)
            args.push("--request-stdin", "--request-sha256", digest(request));
        try {
            const result = await run(python, args, { timeout: action === "workspace-setup" ? 240000 : action === "workspace-stop" ? 120000 : 120000, maxBuffer: 262144, ...(request === null ? {} : {input: request}), shell: false, env: { HOME: os.homedir(), PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: os.tmpdir() } });
            if (Buffer.byteLength(result.stdout) > 262144)
                fail("unsupported_workspace_result", 502);
            return JSON.parse(result.stdout);
        }
        catch (e) {
            if (e.code === "OPERATOR_CLEANUP_UNRESOLVED") {
                blocked = true;
                fail("controller_cleanup_unresolved", 503);
            }
            if (e instanceof OperatorError)
                throw e;
            fail("workspace_command_unconfirmed", 422);
        }
    }
    function projectStatus(r) { const w = r?.workspace; return { installed: r?.installed === true, workspace: { setup: ["not_selected", "absent", "configured", "partial"].includes(w?.setup) ? w.setup : "unknown", authority: ["pending", "configured_native_unqualified", "unavailable"].includes(w?.authority) ? w.authority : "pending", cleanup_unresolved: w?.cleanup_unresolved === true, execution_enabled: false, provider_enabled: false, workflow_selected: false }, components: ["runtime", "service"].map(name => ({ name, live: r?.components?.[name]?.live === true, ready: r?.components?.[name]?.ready === true, managed: r?.components?.[name]?.managed === true })) }; }
    async function state(b) { if (!b.identity)
        return { installed: false, workspace: { setup: "not_selected", authority: "pending", cleanup_unresolved: false, execution_enabled: false, provider_enabled: false, workflow_selected: false }, components: [] }; return projectStatus(await invoke("workspace-status")); }
    function available(s, b) { if (!s.installed)
        return []; const running = s.components.some(c => c.managed); if (s.workspace.cleanup_unresolved || b.files["logs/workspace-operation.json"] || b.files["data/frank-workspace-cleanup.json"])
        return running ? ["workspace-stop"] : []; if (s.workspace.setup === "configured")
        return [...cliActions, running ? "workspace-stop" : "workspace-start"]; return !running && ["not_selected", "absent"].includes(s.workspace.setup) ? ["workspace-prepare", ...(s.workspace.setup === "absent" && b.selection && b.setup ? ["workspace-setup"] : [])] : running ? ["workspace-stop"] : []; }
    function prune() { for (const [id, p] of plans)
        if (clock() >= p.expires + (p.result ? 300000 : 0))
            plans.delete(id); }
    return { enabled, admitMutation(req) { admit(req, true); }, async get(req) { if (!enabled)
            return { schema: "zenith.workspace.v1", mode: "disabled", reason: "Select the local workspace profile on an Apple silicon Mac.", profile: "workspace" }; admit(req); const b = await binding(), s = busy || blocked ? null : await state(b); return { schema: "zenith.workspace.v1", mode: "local", profile: "workspace", target: root, ports: { runtime: 8292, service: 8291 }, csrf, busy: busy || blocked, status: s, configuration_digest: b.digest, actions: busy || blocked ? [] : available(s, b) }; }, async post(req, body) {
            admit(req, true);
            if (busy || blocked)
                fail("operation_in_progress", 409);
            if (body?.operation === "plan") {
                closed(body, ["schema", "operation", "action", "payload"]);
                const action = body.action;
                if (body.schema !== "zenith.workspace-action.v1" || (!cliActions.has(action) && !lifecycle.has(action)))
                    fail("invalid_action");
                if (lifecycle.has(action)) {
                    closed(body.payload, []);
                }
                else
                    validatePayload(action, body.payload);
                // Copy via canonical bytes before any await: a callback cannot mutate retained intent.
                const request = cliActions.has(action) ? canonical({ schema: "zenith.workspace-command.v1", action: action, payload: body.payload, idempotency_key: token() }) : null;
                if (Buffer.byteLength(request || canonical(body.payload)) > 65536)
                    fail("request_too_large", 413);
                prune();
                if (plans.size >= 8)
                    fail("too_many_plans", 429);
                const b = await binding(), s = await state(b);
                if (!available(s, b).includes(action))
                    fail("workspace_action_unavailable", 409);
                prune();
                if (plans.size >= 8)
                    fail("too_many_plans", 429);
                const payload = request ? JSON.parse(request).payload : {}, p = { id: token(), action: action, request, binding: canonical(b), selection: b.selection, expires: clock() + 60000 };
                p.preview = { id: p.id, action: p.action, target: root, payload_sha256: request ? digest(request) : null, configuration_digest: b.digest, setup: action === "workspace-setup" ? b.setup : null, expected_version: Object.hasOwn(payload, "expected_version") ? payload.expected_version : null, request_id: payload.request_id || null, payload, expires_at: p.expires };
                plans.set(p.id, p);
                return { schema: "zenith.workspace-plan.v1", plan: structuredClone(p.preview) };
            }
            closed(body, ["schema", "operation", "plan_id"]);
            if (body.schema !== "zenith.workspace-action.v1" || body.operation !== "apply" || typeof body.plan_id !== "string")
                fail("invalid_request");
            const p = plans.get(body.plan_id);
            if (!p)
                fail("unknown_plan", 409);
            if (p.result)
                return structuredClone(p.result);
            busy = true;
            try {
                const b = await binding();
                if (clock() >= p.expires || canonical(b) !== p.binding)
                    fail("plan_changed_or_expired", 409);
                const s = await state(b);
                if (clock() >= p.expires)
                    fail("plan_changed_or_expired", 409);
                if (!available(s, b).includes(p.action))
                    fail("workspace_action_unavailable", 409);
                const raw = await invoke(cliActions.has(p.action) ? "workspace-command" : p.action, p.request, p.selection);
                p.result = { schema: "zenith.workspace-result.v1", action: p.action, applied: true, payload_sha256: p.preview.payload_sha256, request_id: p.preview.request_id, result: cliActions.has(p.action) ? projectResult(raw, p.action, JSON.parse(p.request).payload) : null };
                return structuredClone(p.result);
            }
            finally {
                busy = blocked;
            }
        } };
}
