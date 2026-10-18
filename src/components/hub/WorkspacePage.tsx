"use client";
// Draft presentation: component-library finalization precedes any dependent Hub commit.
import { useEffect, useRef, useState } from "react";
import { WorkspaceConsole, type WorkspaceProcess as Process, type WorkspaceSnapshot as Snapshot, type WorkspacePlan as Plan } from "@/vendor/zenith-ui/WorkspaceConsole/WorkspaceConsole";
type Data = Record<string, unknown>;
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), v => v.toString(16).padStart(2, "0")).join("");
const newId = () => crypto.randomUUID();
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(v);
export function WorkspacePage() {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [plan, setPlan] = useState<Plan | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("Reading local workspace status…"), [ids, setIds] = useState<string[]>([]), [catalogRead, setCatalogRead] = useState(false), [catalogComplete, setCatalogComplete] = useState(false), [cursor, setCursor] = useState<number | null>(null), [processId, setProcessId] = useState(""), [selected, setSelected] = useState<Process | null>(null), [draftText, setDraftText] = useState(""), [dirty, setDirty] = useState(false), [versionId, setVersionId] = useState(""), [resumeId, setResumeId] = useState(""), [validation, setValidation] = useState<string | null>(null);
    const alive = useRef(true);
    async function refresh() { const r = await fetch("/api/workspace", { cache: "no-store" }); const v = await r.json(); if (!r.ok || v.schema !== "zenith.workspace.v1" || !["local", "disabled"].includes(v.mode))
        throw Error(v.error || "Workspace unavailable"); if (alive.current)
        setSnapshot(v); return v as Snapshot; }
    useEffect(() => { alive.current = true; refresh().then(v => { if (alive.current)
        setMessage(v.mode === "local" ? "No SOP, process or run is selected. Runtime is the source of process records." : v.reason || "Workspace disabled."); }).catch(() => { if (alive.current)
        setMessage("Workspace unavailable. Check the local operator profile."); }); return () => { alive.current = false; }; }, []);
    const allowed = (a: string) => !busy && !snapshot?.busy && snapshot?.mode === "local" && snapshot.actions?.includes(a) === true;
    async function post(body: Data) { const r = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", "X-Zenith-CSRF": snapshot?.csrf || "" }, body: JSON.stringify({ schema: "zenith.workspace-action.v1", ...body }) }); const v = await r.json(); if (!r.ok)
        throw Error(v.error || "workspace_action_unconfirmed"); return v; }
    function acceptResult(result: Data, action: string) {
        if (result.schema === "frank.workspace.catalog.v1") {
            const found = (result.process_ids as string[]) || [];
            setIds(old => Array.from(new Set([...old, ...found])));
            setCatalogRead(true);
            setCatalogComplete(result.after === 0 && result.complete === true && result.cursor_exhausted === true);
            setCursor(result.cursor_exhausted === true ? null : typeof result.next_cursor === "number" ? result.next_cursor : null);
            setMessage(found.length ? "Process catalog observed. Select a process to load its current draft." : result.after === 0 && result.complete === true && result.cursor_exhausted === true ? "No processes found in the observed Runtime catalog. Create an unsaved draft to begin." : "No process IDs in this event page. Load the next page or restart the bounded catalog scan.");
        }
        else if (result.schema === "frank.workspace.process.v1") {
            const p = result.process as Process | null;
            if (!p)
                throw Error("Process record unavailable");
            setSelected(p);
            setProcessId(p.process_id);
            setDraftText(JSON.stringify(p.draft, null, 2));
            setDirty(false);
            setValidation(null);
            setMessage("Loaded the current Runtime draft. No run was selected or created.");
        }
        else if (result.schema === "frank.workspace.validation.v1") {
            setValidation(result.valid === true ? `Valid draft · compilation ${result.compilation_hash}` : `Draft rejected: ${result.code || "invalid_draft"}${result.detail ? " · " + result.detail : ""}`);
            setMessage("Validation completed without saving or publishing.");
        }
        else if (result.schema === "runtime.result.v1") {
            const data = result.result as Data;
            const version = typeof result.version === "number" ? result.version : null;
            if (result.operation === "process.draft.put" && data?.draft) {
                const doc = data.draft as Data;
                setSelected({ process_id: doc.process_id as string, version, revision: data.revision as number, draft: doc, active_version: data.active_version as Data | null });
                setDraftText(JSON.stringify(doc, null, 2));
                setDirty(false);
                setMessage("Draft saved in Runtime. Publishing is a separate reviewed action.");
            }
            else if (result.operation === "process.publish") {
                setSelected(old => old && old.process_id === (data.pin as Data)?.process_id ? { ...old, version, active_version: data.pin as Data } : old);
                setMessage("Immutable version published in Runtime. No run, actor or external effect was created.");
            }
            setResumeId(result.request_id as string);
            setValidation(null);
        }
        else if (action.startsWith("workspace-"))
            setMessage(action === "workspace-prepare" ? "Public setup proposal prepared. Review its finite window and scope before setting up native identity." : action === "workspace-renew-prepare" ? "Public renewal proposal prepared. Review the finite command permission window; the existing identity and journals are retained." : ["workspace-renew", "workspace-renew-resume"].includes(action) ? "Permission renewal completed for the retained identity. Start the workspace explicitly; no run or provider was enabled." : "Workspace action completed. Native configuration is separate from production qualification.");
    }
    async function apply(p: Plan) { const v = await post({ operation: "apply", plan_id: p.id }); if (v.schema !== "zenith.workspace-result.v1" || v.applied !== true)
        throw Error("Unsupported workspace result"); acceptResult(v.result || {}, p.action); setPlan(null); await refresh(); }
    async function review(action: string, payload: Data = {}) { setBusy(true); setValidation(null); try {
        const v = await post({ operation: "plan", action, payload });
        if (v.schema !== "zenith.workspace-plan.v1" || !v.plan?.id)
            throw Error("Unsupported review");
        if (["catalog", "get", "validate"].includes(action))
            await apply(v.plan);
        else {
            setPlan(v.plan);
            if (v.plan.request_id)
                setResumeId(v.plan.request_id);
            setMessage("Review the exact operation, version and payload below.");
        }
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : "Action unconfirmed. Retain the request ID for recovery.");
    }
    finally {
        setBusy(false);
    } }
    function document() { const d = JSON.parse(draftText); if (!d || Array.isArray(d) || d.schema !== "process.draft.v1" || !id(d.process_id))
        throw Error("Enter a process.draft.v1 document with a valid process_id."); return d as Data; }
    function createDraft() { setSelected(null); setPlan(null); setVersionId(""); setValidation(null); setDraftText(JSON.stringify({ schema: "process.draft.v1", process_id: processId, inputs: {}, steps: [{ step_id: "step-1", depends_on: [], capabilities: [], resources: [], inputs: {}, bindings: {}, outputs: {}, max_attempts: 1 }] }, null, 2)); setDirty(true); setMessage("Unsaved draft created in this editor only. Name it, edit its steps and validate before saving."); }
    async function save() { try {
        const d = document();
        await review("draft-put", { schema: "runtime.command.v1", operation: "process.draft.put", request_id: newId(), resource: "processes/" + d.process_id, expected_version: selected && selected.process_id === d.process_id ? selected.version : null, payload: { draft: d, provenance: { source_id: "workspace-" + newId(), media_type: "application/json", content_hash: await hash(draftText), parser: "explicit-json-v1", uncertainties: [] } } });
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : "Invalid draft");
    } }
    function publish() { if (!selected?.version || !selected.revision || dirty || !id(versionId)) {
        setMessage("Save the current draft and enter a new immutable version ID first.");
        return;
    } void review("publish", { schema: "runtime.command.v1", operation: "process.publish", request_id: newId(), resource: "processes/" + selected.process_id, expected_version: selected.version, payload: { process_id: selected.process_id, draft_revision: selected.revision, version_id: versionId } }); }
    function validate() { try {
        void review("validate", document());
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : "Invalid draft");
    } }
    return <WorkspaceConsole snapshot={snapshot} plan={plan} busy={busy} message={message} ids={ids} catalogRead={catalogRead} catalogComplete={catalogComplete} cursor={cursor} processId={processId} selected={selected} draftText={draftText} dirty={dirty} versionId={versionId} resumeId={resumeId} validation={validation} allowed={allowed} onRefresh={() => { setBusy(true); refresh().then(() => setMessage("Local status refreshed. No native catalog query was issued.")).catch(() => setMessage("Status unavailable.")).finally(() => setBusy(false)); }} onAction={a => void review(a)} onCatalog={next => { if (!next)
        setIds([]); void review("catalog", { after: next ? cursor || 0 : 0, limit: 50, max_pages: 1 }); }} onSelect={x => void review("get", { process_id: x })} onProcessId={value => { setProcessId(value); setPlan(null); }} onCreate={createDraft} onDraft={value => { setDraftText(value); setDirty(true); setPlan(null); setValidation(null); }} onValidate={validate} onSave={() => void save()} onCloseEditor={() => { setDraftText(""); setSelected(null); setDirty(false); setPlan(null); setValidation(null); setMessage("Editor closed. Runtime records were preserved."); }} onVersionId={value => { setVersionId(value); setPlan(null); }} onPublish={publish} onApply={() => { if (!plan)
        return; setBusy(true); apply(plan).catch(e => setMessage(`${e.message}. Keep request ID ${plan.request_id || "shown above"}; resume the retained command if its outcome is unknown.`)).finally(() => setBusy(false)); }} onCancel={() => setPlan(null)} onResumeId={setResumeId} onResume={() => void review("resume-command", { request_id: resumeId })}/>;
}
