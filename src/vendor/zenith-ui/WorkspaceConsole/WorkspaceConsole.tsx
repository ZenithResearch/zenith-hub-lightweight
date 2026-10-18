import "./WorkspaceConsole.css";
type Data = Record<string, unknown>;
export type WorkspaceProcess = {
    process_id: string;
    version: number | null;
    revision: number | null;
    draft: Data | null;
    active_version: Data | null;
};
export type WorkspaceSnapshot = {
    schema: string;
    mode: string;
    reason?: string;
    csrf?: string;
    target?: string;
    busy?: boolean;
    actions?: string[];
    status?: {
        installed: boolean;
        workspace: {
            setup: string;
            authority: string;
            cleanup_unresolved: boolean;
            renewal?: { state: "none" | "recovery_required"; resumable: boolean };
            permission?: {
                state: "active" | "not_yet_valid" | "expired" | "unknown";
                not_before: string | null;
                not_after: string | null;
                identity_not_after: string | null;
                observed_at: string | null;
            };
        };
        components: {
            name: string;
            live: boolean;
            ready: boolean;
            managed: boolean;
        }[];
    } | null;
};
export type WorkspacePlan = {
    id: string;
    action: string;
    target: string;
    payload_sha256: string | null;
    configuration_digest: string | null;
    expected_version: number | null;
    request_id: string | null;
    payload: Data;
    expires_at: number;
    setup?: {
        not_before: string;
        not_after: string;
        identity_not_after: string;
        scope: string;
    } | null;
    renewal?: {
        not_before: string;
        not_after: string;
        identity_not_after: string | null;
        previous_complete_sha256: string;
        scope: string;
    } | null;
};
export interface WorkspaceConsoleProps {
    snapshot: WorkspaceSnapshot | null;
    plan: WorkspacePlan | null;
    busy: boolean;
    message: string;
    ids: string[];
    catalogRead: boolean;
    catalogComplete: boolean;
    cursor: number | null;
    processId: string;
    selected: WorkspaceProcess | null;
    draftText: string;
    dirty: boolean;
    versionId: string;
    resumeId: string;
    validation: string | null;
    allowed: (action: string) => boolean;
    onRefresh: () => void;
    onAction: (action: string) => void;
    onCatalog: (next: boolean) => void;
    onSelect: (id: string) => void;
    onProcessId: (value: string) => void;
    onCreate: () => void;
    onDraft: (value: string) => void;
    onValidate: () => void;
    onSave: () => void;
    onCloseEditor: () => void;
    onVersionId: (value: string) => void;
    onPublish: () => void;
    onApply: () => void;
    onCancel: () => void;
    onResumeId: (value: string) => void;
    onResume: () => void;
}
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(v);
const labels: Record<string, string> = { "workspace-prepare": "Prepare native setup proposal", "workspace-setup": "Set up workspace identity", "workspace-start": "Start workspace", "workspace-stop": "Stop workspace", "workspace-renew-prepare": "Prepare permission renewal", "workspace-renew": "Renew workspace permissions", "workspace-renew-resume": "Resume retained permission renewal", "draft-put": "Save draft", "publish": "Publish version", "resume-command": "Resume retained command" };
export function WorkspaceConsole({ snapshot, plan, busy, message, ids, catalogRead, catalogComplete, cursor, processId, selected, draftText, dirty, versionId, resumeId, validation, allowed, onRefresh, onAction, onCatalog, onSelect, onProcessId, onCreate, onDraft, onValidate, onSave, onCloseEditor, onVersionId, onPublish, onApply, onCancel, onResumeId, onResume }: WorkspaceConsoleProps) {
    const w = snapshot?.status?.workspace;
    return <div className="workspace"><a className="workspace-skip" href="#workspace-main">Skip to workspace</a><header className="workspace-top"><a href="/">Zenith</a><span>Process workspace</span><a href="/workspace">Workspace</a></header><main id="workspace-main" tabIndex={-1}>
  <div className="workspace-heading"><div><p className="workspace-eyebrow">Your local process workspace</p><h1>Create a process, then publish it.</h1><p>Start with an empty workspace. Drafts and immutable versions live in Runtime.</p></div><button disabled={busy} onClick={onRefresh}>Refresh status</button></div>
  <p role="status" aria-live="polite" className="workspace-message">{message}</p>
  <section className="workspace-status" aria-label="Workspace environment"><div><strong>{snapshot?.mode === "local" ? "Local controller" : "Not connected"}</strong><p>Isolated Runtime 8292 · Service 8291</p>{snapshot?.status?.components.map(c => <small key={c.name}>{c.name}: {c.live ? "live" : "not observed live"}{" "}</small>)}</div><div><strong>{w?.setup === "configured" ? "Native configured · qualification pending" : w?.setup === "partial" ? "Partial setup retained" : "Workspace setup pending"}</strong><p>Run execution and providers remain disabled.</p></div><div className="workspace-buttons">{["workspace-prepare", "workspace-setup", "workspace-start", "workspace-stop", "workspace-renew-prepare", "workspace-renew", "workspace-renew-resume"].map(a => <button key={a} disabled={!allowed(a)} onClick={() => onAction(a)}>{labels[a]}</button>)}</div>{w?.setup === "configured" && <div className="workspace-wide"><strong>Command permission: {w.permission?.state === "not_yet_valid" ? "not yet valid" : w.permission?.state || "unknown"}</strong><dl><dt>Command permission window (Unix seconds)</dt><dd>{w.permission?.not_before && w.permission?.not_after ? `${w.permission.not_before} → ${w.permission.not_after}` : "Unavailable"}</dd><dt>Machine identity key expires (Unix seconds)</dt><dd>{w.permission?.identity_not_after || "Unavailable in this receipt"}</dd><dt>Status observed at (Unix seconds)</dt><dd>{w.permission?.observed_at || "Unavailable"}</dd></dl><p>Existing identity is retained. Stop the workspace, prepare a permission renewal, then review and apply the same five scopes for at most one hour. No automatic permission renewal or key rotation. Refresh status for the latest local observation.</p></div>}{snapshot?.target && <small className="workspace-wide">{snapshot.target}</small>}{w?.cleanup_unresolved && <p className="workspace-wide" role="alert">A workspace operation requires reconciliation. Preserve the workspace and its receipts. Resume only the exact retained permission renewal when that action is available; unresolved ownership or prepared Native recovery remains blocked.</p>}</section>
  <div className="workspace-columns"><section aria-labelledby="processes-heading"><h2 id="processes-heading">Processes</h2><p>{catalogRead ? (ids.length ? `${ids.length} process IDs observed.` : catalogComplete ? "No processes in the observed Runtime catalog." : "No process IDs in the observed event pages.") : "No process selected. Load the catalog when you are ready."}</p><div className="workspace-buttons"><button disabled={!allowed("catalog")} onClick={() => onCatalog(false)}>Load process catalog</button>{cursor !== null && <button disabled={!allowed("catalog")} onClick={() => onCatalog(true)}>Load next page</button>}</div>{ids.length > 0 && <ul className="workspace-processes">{ids.map(x => <li key={x}><button disabled={!allowed("get") || dirty} onClick={() => onSelect(x)}>{x}</button></li>)}</ul>}<label htmlFor="workspace-process-id">Process ID</label><input disabled={busy} id="workspace-process-id" value={processId} maxLength={128} placeholder="Enter a process ID" onChange={e => onProcessId(e.target.value)}/><div className="workspace-buttons"><button disabled={!allowed("get") || !id(processId) || dirty} onClick={() => onSelect(processId)}>Load current draft</button><button disabled={busy || Boolean(draftText && dirty) || !id(processId)} onClick={onCreate}>Create unsaved draft</button></div><p className="workspace-note">Catalog and process reads are explicit. The page does not poll native queries or select an SOP, actor or run.</p></section>
  <section aria-labelledby="draft-heading"><h2 id="draft-heading">{selected ? `Draft: ${selected.process_id}` : "Draft editor"}</h2>{!draftText ? <div className="workspace-empty"><h3>No draft is open</h3><p>Enter a process ID and create an unsaved draft, or load an existing process from Runtime.</p></div> : <><p>{selected ? `Runtime version ${selected.version}; draft revision ${selected.revision}.` : "New draft · not stored in Runtime"} {dirty && "Unsaved changes"}</p><label htmlFor="workspace-draft">Process draft JSON</label><textarea disabled={busy} id="workspace-draft" spellCheck={false} value={draftText} onChange={e => onDraft(e.target.value)} rows={21}/><div className="workspace-buttons"><button disabled={!allowed("validate")} onClick={onValidate}>Validate draft</button><button disabled={!allowed("draft-put")} onClick={onSave}>Review save draft</button><button disabled={busy} onClick={onCloseEditor}>Close editor</button></div>{validation && <p role="status" className="workspace-note">{validation}</p>}<fieldset><legend>Publish a saved draft</legend><label htmlFor="workspace-version-id">New immutable version ID</label><input disabled={busy} id="workspace-version-id" value={versionId} maxLength={128} onChange={e => onVersionId(e.target.value)}/><button disabled={!allowed("publish") || dirty || !selected?.version || !id(versionId)} onClick={onPublish}>Review publish version</button><p className="workspace-note">Publishing freezes this saved revision. It does not start a run or enable an actor.</p></fieldset></>}</section></div>
  {plan && <section className="workspace-review" aria-labelledby="workspace-review-heading"><h2 id="workspace-review-heading">Review {labels[plan.action] || plan.action}</h2><dl><dt>Destination</dt><dd>{plan.target}</dd><dt>Expected Runtime version</dt><dd>{plan.expected_version === null ? "New record / not applicable" : plan.expected_version}</dd><dt>Request ID</dt><dd>{plan.request_id || "Local owner action"}</dd><dt>Payload SHA-256</dt><dd>{plan.payload_sha256 || "No command payload"}</dd><dt>Configuration SHA-256</dt><dd>{plan.configuration_digest || "Not configured"}</dd>{plan.setup && <><dt>Command permission window (Unix seconds)</dt><dd>{plan.setup.not_before} → {plan.setup.not_after}; at most one hour</dd><dt>Machine identity key expires (Unix seconds)</dt><dd>{plan.setup.identity_not_after}</dd><dt>Identity lifecycle</dt><dd>No automatic renewal or key rotation. You control revocation.</dd><dt>Allowed scope</dt><dd>{plan.setup.scope}</dd></>}{plan.renewal && <><dt>Command permission renewal window (Unix seconds)</dt><dd>{plan.renewal.not_before} → {plan.renewal.not_after}; at most one hour</dd><dt>Machine identity key expires (Unix seconds)</dt><dd>{plan.renewal.identity_not_after || "Unavailable in this receipt"}</dd><dt>Previous native receipt SHA-256</dt><dd>{plan.renewal.previous_complete_sha256}</dd><dt>Retained identity and scope</dt><dd>{plan.renewal.scope} No automatic renewal.</dd></>}<dt>Review expires</dt><dd>{new Date(plan.expires_at).toLocaleTimeString()}</dd></dl><details><summary>Exact reviewed payload</summary><pre>{JSON.stringify(plan.payload, null, 2)}</pre></details><div className="workspace-buttons"><button disabled={busy} onClick={onApply}>Apply reviewed action</button><button disabled={busy} onClick={onCancel}>Cancel review</button></div></section>}
  <details className="workspace-recovery"><summary>Recover an unconfirmed save or publish</summary><p>Resume the exact retained command. This does not create a new command or change its payload.</p><label htmlFor="workspace-resume">Retained request ID</label><input disabled={busy} id="workspace-resume" value={resumeId} maxLength={128} onChange={e => onResumeId(e.target.value)}/><button disabled={!allowed("resume-command") || !id(resumeId)} onClick={onResume}>Review resume command</button></details>
 </main></div>;
}
