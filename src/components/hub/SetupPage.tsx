"use client";
import { useEffect, useState, useRef } from "react";
import {
  HermesSetupLanding,
  type HermesEntryState,
  SetupShell,
  SetupIntro,
  SetupPanel,
  ComponentChoice,
  ConnectionList,
  StateFacts,
  SourceDetails,
  PlanReview,
  type SetupStep,
} from "@/vendor/zenith-ui/HubSetup/HubSetup";
import { HermesModelPicker, type HermesModelOptions, type HermesSignIn } from "@/vendor/zenith-ui/HubSetup/HermesModelPicker";
import { communicationRows, type CommunicationRow } from "@/lib/setup/connections.mjs";
import { modelChoiceKey, withSuggestedModel } from "@/lib/setup/model-choice.mjs";
// The runtime catalog is validated by the controller; this client never dispatches shell commands.
type Selection = {
  instanceId: string;
  componentId: string;
  mode: string;
  config: Record<string, any>;
  targetId?: string;
};
type Snapshot = {
  mode: string;
  csrf: string;
  revision: number;
  step: SetupStep;
  root: string;
  catalog: { components: any[] };
  catalogSha256: string;
  selection: Selection[];
  instances: any[];
  operations: any[];
  busy: boolean;
};
export function SetupPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [selection, setSelection] = useState<Selection[]>([]),
    [step, setStep] = useState<SetupStep>("welcome"),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false),
    [plan, setPlan] = useState<any>(null),
    [candidates, setCandidates] = useState<any[] | null>(null),
    [installDraft, setInstallDraft] = useState<Selection | null>(null),
    [hermesTarget, setHermesTarget] = useState<string | null>(null),
    [quickConfigOpen, setQuickConfigOpen] = useState(false),
    [modelOptions, setModelOptions] = useState<Record<string, HermesModelOptions>>({}),
    [modelLoading, setModelLoading] = useState<Record<string, boolean>>({}),
    [modelError, setModelError] = useState<Record<string, string>>({}),
    [modelCatalogs, setModelCatalogs] = useState<Record<string, { models: string[]; recommendedModel?: string; currentModel?: string }>>({}),
    [providerSignIns, setProviderSignIns] = useState<Record<string, HermesSignIn>>({}),
    [detail, setDetail] = useState<string | null>(null),
    [fetchedAt, setFetchedAt] = useState(0),
    [now, setNow] = useState(Date.now()),
    [backendDraft, setBackendDraft] = useState<
      Record<string, Record<string, any>>
    >({});
  const modelCatalogRequests = useRef(new Map<string, Promise<void>>());
  const initialized = useRef(false),
    latest = useRef<Snapshot | null>(null),
    generation = useRef(0),
    refreshInFlight = useRef<AbortController | null>(null),
    mounted = useRef(false);
  function receive(v: Snapshot) {
    if (
      latest.current &&
      latest.current.csrf === v.csrf &&
      v.revision < latest.current.revision
    )
      return;
    latest.current = v;
    setSnapshot(v);
    setFetchedAt(Date.now());
    window.dispatchEvent(new CustomEvent("zenith:hub-setup-snapshot", { detail: v }));
    if (!initialized.current) {
      let draft: any = null;
      try {
        const raw = sessionStorage.getItem("zenith.hub.setup.draft.v1");
        if (raw && raw.length < 65536) {
          const d = JSON.parse(raw);
          if (
            d.root === v.root &&
            Array.isArray(d.selection) &&
            [
              "welcome",
              "communications",
              "components",
              "review",
              "environment",
            ].includes(d.step)
          )
            draft = d;
        }
      } catch {}
      setSelection(draft?.selection || v.selection);
      if (draft?.backendDraft && typeof draft.backendDraft === "object")
        setBackendDraft(draft.backendDraft);
      initialized.current = true;
    }
  }
  async function refresh() {
    if (refreshInFlight.current) return;
    const abort = new AbortController(),
      epoch = generation.current;
    refreshInFlight.current = abort;
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const r = await fetch("/api/setup", {
        cache: "no-store",
        signal: abort.signal,
      });
      if (!r.ok) {
        const failure = await r.json().catch(() => null);
        throw Error("Setup check failed (HTTP " + r.status +
          (typeof failure?.error === "string" ? "; " + failure.error.replaceAll("_", " ") : "") +
          "). Your edits and review are retained.");
      }
      const v = await r.json();
      if (v.mode !== "local")
        throw Error("Guided setup is disabled on this operator.");
      if (mounted.current && refreshInFlight.current === abort && epoch === generation.current) {
        receive(v);
        setConnectionError("");
      }
    } catch (e) {
      if (mounted.current && refreshInFlight.current === abort && epoch === generation.current) {
        setFetchedAt(0);
        setConnectionError(
          (e as Error).name === "AbortError"
            ? "Controller check timed out. Your edits are retained; retry the check."
            : (e as Error).message,
        );
      }
    } finally {
      clearTimeout(timer);
      if (refreshInFlight.current === abort) refreshInFlight.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = setInterval(() => void refresh(), 5000),
      tick = setInterval(() => setNow(Date.now()), 1000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("zenith:hub-setup-refresh", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(tick);
      const cancelled = refreshInFlight.current;
      refreshInFlight.current = null;
      cancelled?.abort();
      window.removeEventListener("focus", focus);
      window.removeEventListener("zenith:hub-setup-refresh", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, []);
  useEffect(() => {
    if (!initialized.current || !snapshot?.root) return;
    try {
      sessionStorage.setItem(
        "zenith.hub.setup.draft.v1",
        JSON.stringify({ root: snapshot.root, selection, backendDraft, step }),
      );
    } catch {}
  }, [selection, backendDraft, step, snapshot?.root]);
  const stale = !snapshot || !fetchedAt || now - fetchedAt > 30000,
    disabled = busy || snapshot?.busy === true || stale;
  const catalog = snapshot?.catalog.components || [];
  async function action(
    operation: string,
    fields: Record<string, unknown> = {},
  ) {
    if (!latest.current || stale)
      throw Error("Refresh the controller before continuing.");
    generation.current++;
    refreshInFlight.current?.abort();
    const r = await fetch("/api/setup", {
      method: "POST",
      headers: {
        Origin: location.origin,
        "Content-Type": "application/json",
        "X-Zenith-CSRF": latest.current.csrf,
      },
      body: JSON.stringify({
        schema: "zenith.hub-setup-action.v1",
        operation,
        ...fields,
      }),
    });
    const v = await r.json();
    if (!r.ok)
      throw Error(
        (operation === "hermes-model" && v.message) ||
        v.error?.replaceAll("_", " ") ||
          "Setup action incomplete. Refresh and reconcile before retrying.",
      );
    if (v.revision !== undefined) {
      receive(v);
      generation.current++;
    }
    return v;
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }
  function leaveHermesForm() {
    setQuickConfigOpen(false);
    setInstallDraft(null);
    setHermesTarget(null);
  }
  async function navigate(next: SetupStep) {
    if (!snapshot || snapshot.busy) {
      leaveHermesForm();
      setStep(next);
      return;
    }
    await perform(async () => {
      await action("save", {
        selection,
        step: next,
        expectedRevision: latest.current?.revision,
      });
      leaveHermesForm();
      setStep(next);
    });
  }
  function choose(c: any, selected: boolean) {
    setPlan(null);
    setSelection((s) =>
      selected
        ? [
            ...s,
            {
              componentId: c.id,
              instanceId: c.id + "-local",
              mode: c.id === "devgraph" ? "connect" : "install",
              config:
                c.id === "matrix"
                  ? {
                      port: 18008,
                      serverName: "",
                      domainMode: "owned",
                      access: "private",
                      identityAcknowledged: false,
                      federation: false,
                      tailscale: false,
                    }
                  : c.id === "hermes"
                    ? { port: 18642 }
                    : c.id === "devgraph"
                      ? { endpoint: "http://127.0.0.1:4220" }
                      : c.defaultPort
                        ? { port: c.defaultPort }
                        : {},
            },
          ]
        : s.filter((i) => i.componentId !== c.id),
    );
  }
  function edit(id: string, values: Partial<Selection>) {
    setPlan(null);
    setSelection((s) =>
      s.map((i) => (i.componentId === id ? { ...i, ...values } : i)),
    );
  }
  function config(id: string, field: string, value: unknown) {
    setPlan(null);
    setSelection((s) =>
      s.map((i) =>
        i.componentId === id
          ? { ...i, config: { ...i.config, [field]: value } }
          : i,
      ),
    );
  }
  async function review(
    actionName = "install",
    instanceId?: string,
    backend?: Record<string, any>,
  ) {
    await perform(async () => {
      const installItem = actionName === "install" ? installDraft : null;
      if (!instanceId && !installItem)
        await action("save", {
          step,
          selection,
          expectedRevision: latest.current?.revision,
        });
      const v = await action("plan", {
        action: actionName,
        expectedRevision: latest.current?.revision,
        ...(instanceId
          ? { instanceId }
          : {
              selection: installItem
                ? [installItem]
                : actionName === "prepare-artifacts"
                  ? selection.filter((i) => i.componentId === "matrix")
                  : selection,
            }),
        ...(backend ? { backend } : {}),
      });
      setPlan({ ...v.plan, controllerSession: latest.current?.csrf });
      if (!quickConfigOpen) setStep("review");
    });
  }
  const connectionRows = communicationRows(snapshot?.instances || [], candidates, selection, {
    stale, now, labels: Object.fromEntries(catalog.map((c) => [c.id, c.label])),
  });
  function chooseConnection(row: CommunicationRow) {
    if (disabled || row.action !== "choose") return;
    const descriptor = catalog.find((c) => c.id === row.componentId);
    if (!selection.some((i) => i.componentId === row.componentId)) choose(descriptor, true);
    setSelection((s) => s.map((i) => i.componentId === row.componentId ? { ...i, mode: "connect", config: { endpoint: row.endpoint } } : i));
  }
  function choice(c: any) {
    const item = selection.find((i) => i.componentId === c.id);
    return (
      <ComponentChoice
        key={c.id}
        name={c.label}
        description={c.description}
        selected={!!item}
        onSelect={(s) => choose(c, s)}
      >
        {item && (
          <>
            <div className="zn-setup__grid">
              <label>
                How should this component join?
                <select
                  value={item.mode}
                  onChange={(e) => edit(c.id, { mode: e.target.value })}
                >
                  {c.modes.map((m: string) => (
                    <option key={m} value={m}>
                      {m === "install"
                        ? "Install on this Mac"
                        : m === "connect"
                          ? "Connect an existing service"
                          : "Deploy to a VPS"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Instance name
                <input
                  value={item.instanceId}
                  maxLength={48}
                  onChange={(e) => edit(c.id, { instanceId: e.target.value })}
                />
              </label>
            </div>
            {item.mode === "connect" ? (
              <label>
                Service API address
                <input
                  type="url"
                  placeholder="https://service.example.com"
                  value={item.config.endpoint || ""}
                  onChange={(e) => config(c.id, "endpoint", e.target.value)}
                />
              </label>
            ) : (
              <label>
                Local service port
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  value={item.config.port || ""}
                  onChange={(e) => config(c.id, "port", Number(e.target.value))}
                />
              </label>
            )}
            {c.id === "matrix" && item.mode !== "connect" && (
              <>
                <label>
                  Server identity domain
                  <input
                    placeholder="chat.your-organization.com"
                    value={item.config.serverName || ""}
                    onChange={(e) => config(c.id, "serverName", e.target.value)}
                  />
                </label>
                <p>
                  Your users will be @name:
                  {item.config.serverName || "your-server-name"}. This identity
                  is separate from the API address and cannot be transparently
                  renamed after initialization.
                </p>
                <div className="zn-setup__grid">
                  <label>
                    Domain ownership
                    <select
                      value={item.config.domainMode || "owned"}
                      onChange={(e) =>
                        config(c.id, "domainMode", e.target.value)
                      }
                    >
                      <option value="owned">My own domain</option>
                      <option value="managed">Managed Zenith subdomain</option>
                      <option value="development">
                        Disposable development identity
                      </option>
                    </select>
                  </label>
                  <label>
                    Access
                    <select
                      value={item.config.access || "private"}
                      onChange={(e) => config(c.id, "access", e.target.value)}
                    >
                      <option value="private">Private / this Mac</option>
                      <option value="public-client">
                        Public clients with TLS
                      </option>
                      <option value="federated">
                        Public clients and federation
                      </option>
                    </select>
                  </label>
                </div>
                {item.config.domainMode === "managed" && (
                  <p>
                    Reserve a unique subdomain with the Zenith domain operator
                    first. A reservation and DNS/TLS adapter are required before
                    deployment.
                  </p>
                )}
                {item.config.domainMode === "development" && (
                  <p>
                    A development identity remains a separate homeserver. Moving
                    to a different identity means creating another server and
                    migrating accounts/data deliberately.
                  </p>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={item.config.federation === true}
                    onChange={(e) =>
                      config(c.id, "federation", e.target.checked)
                    }
                  />{" "}
                  Enable federation with other homeservers
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={item.config.tailscale === true}
                    onChange={(e) =>
                      config(c.id, "tailscale", e.target.checked)
                    }
                  />{" "}
                  Use Tailscale for private access
                </label>
                <p>
                  Tailscale access does not establish public reachability or
                  federation.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={item.config.identityAcknowledged === true}
                    onChange={(e) =>
                      config(c.id, "identityAcknowledged", e.target.checked)
                    }
                  />{" "}
                  I have chosen this homeserver’s permanent identity.
                </label>
              </>
            )}
            {c.id === "hermes" && item.mode === "install" && (
              <details>
                <summary>
                  Optional model backend · can be configured after installation
                </summary>
                <p>
                  Installing Hermes does not download a model or activate a paid
                  provider. A local agent can use a remote model. Choose a local
                  endpoint for inference that stays on this machine.
                </p>
                <label>
                  Backend
                  <select
                    value={item.config.backendKind || "local"}
                    onChange={(e) =>
                      config(c.id, "backendKind", e.target.value)
                    }
                  >
                    <option value="local">
                      Local OpenAI-compatible model server
                    </option>
                    <option value="remote">
                      Remote OpenAI-compatible provider
                    </option>
                  </select>
                </label>
                <label>
                  Model server address
                  <input
                    placeholder="http://127.0.0.1:11434"
                    value={item.config.modelEndpoint || ""}
                    onChange={(e) =>
                      config(c.id, "modelEndpoint", e.target.value)
                    }
                  />
                </label>
                <label>
                  Model name
                  <input
                    placeholder="The model loaded by your server"
                    value={item.config.modelName || ""}
                    onChange={(e) => config(c.id, "modelName", e.target.value)}
                  />
                </label>
                <label>
                  Private credential reference (remote provider)
                  <input
                    value={item.config.secretRef || ""}
                    onChange={(e) => config(c.id, "secretRef", e.target.value)}
                  />
                </label>
                <p>
                  Credential values stay in the owner’s private secret store. An
                  unavailable backend leaves static help available.
                </p>
              </details>
            )}
            {item.mode === "vps" && (
              <label>
                Owner-configured VPS target ID
                <input
                  value={item.targetId || ""}
                  onChange={(e) => edit(c.id, { targetId: e.target.value })}
                />
              </label>
            )}
            <SourceDetails
              repository={c.source.repository}
              revision={
                c.source.commit ||
                c.source.version ||
                "Owner configuration required"
              }
              schema={c.configurationSchema}
            >
              <p>
                Package dependencies:{" "}
                {c.packageDependencies.join(", ") || "None separately required"}
                . Service connections:{" "}
                {c.serviceRequirements.join(", ") || "None required for setup"}.
              </p>
              <p>{c.prerequisites.join(" · ")}</p>
            </SourceDetails>
          </>
        )}
      </ComponentChoice>
    );
  }
  async function modelAction(i: any, request: Record<string, unknown>) {
    setModelLoading((v) => ({ ...v, [i.instanceId]: true }));
    setModelError((v) => ({ ...v, [i.instanceId]: "" }));
    try {
      const result = await action("hermes-model", { instanceId: i.instanceId, modelRequest: request });
      const data = result.data;
      if (request.action === "options") setModelOptions((v) => ({ ...v, [i.instanceId]: data }));
      return data;
    } catch (e) {
      setModelError((v) => ({ ...v, [i.instanceId]: (e as Error).message }));
      return undefined;
    } finally {
      setModelLoading((v) => ({ ...v, [i.instanceId]: false }));
    }
  }
  async function loadModelCatalog(i: any, requested: Record<string, any>) {
    const key = modelChoiceKey(i.instanceId, requested);
    const pending = modelCatalogRequests.current.get(key);
    if (pending) return pending;
    const task = (async () => {
      const data = await modelAction(i, !requested.providerId || requested.providerId === "custom"
        ? { action: "endpoint-models", endpoint: requested.modelEndpoint, ...(requested.secretRef ? { secretRef: requested.secretRef } : {}) }
        : { action: "models", providerId: requested.providerId });
      if (!data) return;
      setModelCatalogs((v) => ({ ...v, [key]: data }));
      setBackendDraft((drafts) => {
        const current = { ...i.config, ...drafts[i.instanceId] };
        const suggested = withSuggestedModel(current, requested, data);
        return suggested === current ? drafts : { ...drafts, [i.instanceId]: { ...drafts[i.instanceId], modelName: suggested.modelName } };
      });
    })().finally(() => modelCatalogRequests.current.delete(key));
    modelCatalogRequests.current.set(key, task);
    return task;
  }
  function modelBackend(i: any) {
    const value = { ...i.config, ...backendDraft[i.instanceId] };
    const key = modelChoiceKey(i.instanceId, value);
    const progress = snapshot?.operations.find((op) => op.action === "setup-local-model" && op.instanceIds?.includes(i.instanceId) && op.state === "applying")?.progress?.[0];
    return (
      <HermesModelPicker
        options={modelOptions[i.instanceId]}
        value={value}
        disabled={disabled}
        stopped={i.running === false}
        loading={modelLoading[i.instanceId] || false}
        error={modelError[i.instanceId]}
        models={modelCatalogs[key]?.models || []}
        modelsLoaded={!!modelCatalogs[key]}
        recommendedModel={modelCatalogs[key]?.recommendedModel}
        signIn={providerSignIns[i.instanceId]}
        progress={progress}
        onChange={(next) => setBackendDraft((v) => ({ ...v, [i.instanceId]: { ...v[i.instanceId], ...next } }))}
        onLoadOptions={() => void modelAction(i, { action: "options" })}
        onLoadModels={() => void loadModelCatalog(i, value)}
        onConnectKey={async (apiKey) => {
          const result = await modelAction(i, { action: "connect-key", providerId: value.providerId, apiKey });
          if (result) {
            await modelAction(i, { action: "options" });
            await loadModelCatalog(i, value);
          }
        }}
        onSignIn={() => void (async () => {
          const result = await modelAction(i, { action: "oauth-start", providerId: value.providerId });
          if (result) setProviderSignIns((v) => ({ ...v, [i.instanceId]: { ...result, providerId: value.providerId, status: "pending" } }));
        })()}
        onRefreshSignIn={() => void (async () => {
          const login = providerSignIns[i.instanceId];
          if (!login) return;
          const result = await modelAction(i, { action: "oauth-poll", providerId: login.providerId, sessionId: login.session_id });
          if (result) {
            setProviderSignIns((v) => ({ ...v, [i.instanceId]: { ...login, ...result } }));
            if (result.status === "approved") {
              await modelAction(i, { action: "options" });
              await loadModelCatalog(i, { ...i.config, ...backendDraft[i.instanceId], providerId: login.providerId });
            }
          }
        })()}
        onCancelSignIn={() => void (async () => {
          const login = providerSignIns[i.instanceId];
          if (!login) return;
          const result = await modelAction(i, { action: "oauth-cancel", sessionId: login.session_id });
          if (result) setProviderSignIns((v) => { const copy = { ...v }; delete copy[i.instanceId]; return copy; });
        })()}
        onReview={() => void review("configure-backend", i.instanceId, { ...value, providerId: value.providerId || "custom" })}
        onSetupLocal={(localModelId) => void review("setup-local-model", i.instanceId, { ...value, providerId: "llamacpp", backendKind: "local", localModelId })}
        onPauseResume={() => progress?.jobId && void modelAction(i, { action: progress.jobState === "paused" ? "local-resume" : "local-pause", jobId: progress.jobId })}
      />
    );
  }
  function renderReview() {
    return (
        <>
          <SetupIntro eyebrow="BEFORE ANY CHANGES" title="Review your setup." />
          {plan ? (
            <PlanReview
              title={plan.action + " selected components"}
              busy={busy}
              blocked={
                disabled ||
                now > plan.expiresAt ||
                snapshot?.revision !== plan.revision ||
                snapshot?.csrf !== plan.controllerSession ||
                snapshot?.catalogSha256 !== plan.catalogSha256 ||
                plan.items.some((i: any) => i.prerequisites.length > 0)
              }
              onCancel={() =>
                void perform(async () => {
                  await action("cancel", { planId: plan.id });
                  setPlan(null);
                  if (!quickConfigOpen) setStep(
                    installDraft
                      ? "communications"
                      : hermesTarget
                        ? "environment"
                        : "components",
                  );
                })
              }
              onApply={() =>
                void perform(async () => {
                  await action("apply", { planId: plan.id, background: true });
                  setPlan(null);
                  if (!quickConfigOpen) {
                    leaveHermesForm();
                    setStep("environment");
                  }
                })
              }
            >
              {plan.items.map((i: any) => (
                <section key={i.instanceId}>
                  <h3>
                    {i.descriptor.label} · {i.instanceId}
                  </h3>
                  <StateFacts
                    facts={[
                      {
                        label: "Action",
                        value:
                          i.mode === "connect"
                            ? "Register external connection"
                            : plan.action,
                      },
                      {
                        label: "Source",
                        value:
                          i.descriptor.source.repository +
                          " @ " +
                          (i.descriptor.source.commit ||
                            i.descriptor.source.version),
                      },
                      {
                        label:
                          plan.action === "prepare-artifacts"
                            ? "Artifact preparation destination"
                            : "Software destination",
                        value:
                          i.mode === "connect"
                            ? "Owned by the external service"
                            : i.preparation?.directory &&
                                plan.action === "prepare-artifacts"
                              ? i.preparation.directory
                              : i.destination,
                      },
                      {
                        label: "Persistent data",
                        value:
                          i.mode === "connect"
                            ? "Remains with its owner"
                            : i.dataPath,
                      },
                      {
                        label: "Port / endpoint",
                        value:
                          i.config.endpoint ||
                          String(i.config.port || "No HTTP daemon"),
                      },
                      { label: "Start behavior", value: i.startBehavior },
                    ]}
                  />
                  <p>{i.effects.join(" ")}</p>
                  {i.componentId === "matrix" && (
                    <StateFacts
                      facts={[
                        {
                          label: "Homeserver identity",
                          value: i.config.serverName,
                        },
                        {
                          label: "Network access / federation",
                          value:
                            i.config.access +
                            " / " +
                            (i.config.federation ? "enabled" : "disabled"),
                        },
                        {
                          label: "Tailscale selection",
                          value: i.config.tailscale
                            ? "Separately reviewed access required"
                            : "Not selected",
                        },
                      ]}
                    />
                  )}
                  {i.componentId === "hermes" && (i.config.modelEndpoint || i.config.providerId) && (
                    <StateFacts
                      facts={[
                        {
                          label: "Model backend",
                          value: i.config.providerId && i.config.providerId !== "custom"
                            ? i.config.providerId
                            : i.config.backendKind + " · " + i.config.modelEndpoint,
                        },
                        {
                          label: "Model / served context",
                          value: i.config.modelName + (i.config.contextLength
                            ? " · " + i.config.contextLength + " tokens"
                            : " · automatic context"),
                        },
                        {
                          label: "Provider credential",
                          value:
                            i.config.providerId && !["custom", "llamacpp"].includes(i.config.providerId)
                              ? "Managed privately by Hermes"
                              : i.config.secretRef || "No provider credential selected",
                        },
                      ]}
                    />
                  )}
                  {i.runtimePins?.localModel && (
                    <StateFacts facts={[
                      { label: "Local model", value: i.runtimePins.localModel.model.name },
                      { label: "Download / free space needed", value: (i.runtimePins.localModel.downloadBytes / 1024 ** 3).toFixed(1) + " GB / " + (i.runtimePins.localModel.requiredBytes / 1024 ** 3).toFixed(1) + " GB" },
                      { label: "Models directory", value: i.runtimePins.localModel.modelsDirectory },
                    ]} />
                  )}
                  {i.runtimePins?.storage && (
                    <p>
                      Storage on artifact volume:{" "}
                      {i.runtimePins.storage.availableMiB} MiB available;{" "}
                      {i.runtimePins.storage.requiredMiB} MiB required for this
                      action.
                    </p>
                  )}
                  {i.bootstrap && (
                    <p>
                      Installer bootstrap: Python {i.bootstrap.version} ·{" "}
                      <code>{i.bootstrap.executable}</code>. Managed component
                      runtimes are separate.
                    </p>
                  )}
                  {i.serviceRequirements?.some((d: any) => !d.satisfied) && (
                    <p>
                      Execution dependency still to connect:{" "}
                      {i.serviceRequirements
                        .filter((d: any) => !d.satisfied)
                        .map((d: any) => d.componentId)
                        .join(", ")}
                      . These servers will not be installed or started by this
                      plan.
                    </p>
                  )}
                  {i.runtimePins && (
                    <details>
                      <summary>Pinned runtime, source and build inputs</summary>
                      <pre>{JSON.stringify(i.runtimePins, null, 2)}</pre>
                    </details>
                  )}
                  {i.prerequisites.length > 0 && (
                    <div role="status" className="zn-setup__error">
                      <strong>Prerequisites</strong>
                      <ul>
                        {i.prerequisites.map((p: string) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details>
                    <summary>
                      {i.artifacts.length} exact package artifacts
                    </summary>
                    <ul>
                      {i.artifacts.map((a: any) => (
                        <li key={a.sha256}>
                          {a.package || a.filename} {a.version} · {a.bytes}{" "}
                          bytes
                          <br />
                          <code>{a.sha256}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                </section>
              ))}
              {(now > plan.expiresAt ||
                snapshot?.revision !== plan.revision ||
                snapshot?.csrf !== plan.controllerSession) && (
                <p role="status">
                  This review expired or the controller state changed. Cancel it
                  and create a fresh review before applying.
                </p>
              )}
              <details>
                <summary>Plan integrity and expiry</summary>
                <code>{plan.digest}</code>
                <p>
                  Expires {new Date(plan.expiresAt).toLocaleTimeString()}.
                  Source, state or destination changes require another review.
                </p>
              </details>
            </PlanReview>
          ) : (
            <SetupPanel title="No active review">
              <p>
                Choose components to create a current plan. An expired or
                cancelled review cannot be applied.
              </p>
              <button onClick={() => void navigate("components")}>
                Choose components
              </button>
            </SetupPanel>
          )}
        </>
    );
  }
  const hermesInstances = (snapshot?.instances || []).filter(
    (i) => i.componentId === "hermes",
  );
  const installed = hermesInstances.filter(
    (i) => i.mode === "install" && i.installed === true && !i.partial,
  );
  const retained = hermesInstances.filter((i) => i.mode === "install");
  const connections = hermesInstances.filter((i) => i.mode === "connect");
  const selectedHermes = hermesInstances.find(
    (i) => i.instanceId === hermesTarget,
  );

  if (step === "welcome") {
    let state: HermesEntryState;
    if (connectionError || (snapshot && stale)) state = "unavailable";
    else if (!snapshot || busy) state = "checking";
    else if (installed.length) state = "configure";
    else if (retained.length) state = "recover";
    else if (connections.length) state = "configure";
    else if (
      !catalog.some((c) => c.id === "hermes" && c.modes.includes("install"))
    )
      state = "unavailable";
    else state = "install";
    const target = installed[0] || retained[0] || connections[0];
    return (
      <HermesSetupLanding
        state={state}
        continueDisabled={disabled}
        unavailableReason={connectionError || (stale && snapshot ? "The setup check is out of date. Check again before continuing." : "The Hermes installer is missing from this controller’s component catalog.")}
        onRetry={() => { setConnectionError(""); void refresh(); }}
        onContinue={() => {
          setError("");
          setPlan(null);
          if (state === "configure") {
            void navigate("communications");
          } else if (state === "install") {
            const saved = selection.find(
              (i) => i.componentId === "hermes" && i.mode === "install",
            );
            setInstallDraft({
              componentId: "hermes",
              instanceId: saved?.instanceId ?? "hermes-local",
              mode: "install",
              config: { port: saved?.config.port ?? 18642 },
            });
            setStep("communications");
          } else if (target) {
            setHermesTarget(target.instanceId);
            setStep("environment");
          }
        }}
        onConfigure={() => {
          if (!target || stale || busy) return;
          setError("");
          setPlan(null);
          setHermesTarget(target.instanceId);
          setQuickConfigOpen(true);
          if (target.mode === "install") void modelAction(target, { action: "options" });
        }}
        configurationBusy={busy}
        onCloseConfiguration={() => {
          if (busy) return;
          const close = () => {
            setPlan(null);
            setQuickConfigOpen(false);
            setHermesTarget(null);
          };
          if (plan && !stale) {
            void perform(async () => {
              await action("cancel", { planId: plan.id });
              close();
            });
          } else close();
        }}
        configuration={quickConfigOpen ? (
          <>
            {(connectionError || error) && (
              <p role="alert" className="zn-setup__error">{connectionError || error}</p>
            )}
            {plan ? renderReview() : selectedHermes ? (
              <>
                {hermesInstances.length > 1 && (
                  <label>
                    Hermes instance
                    <select value={hermesTarget || ""} onChange={(e) => setHermesTarget(e.target.value)}>
                      {hermesInstances.map((i) => <option key={i.instanceId} value={i.instanceId}>{i.instanceId}</option>)}
                    </select>
                  </label>
                )}
                <StateFacts facts={[
                  { label: "Instance", value: selectedHermes.instanceId },
                  { label: "Hermes API", value: selectedHermes.mode === "connect"
                    ? selectedHermes.config.endpoint
                    : "http://127.0.0.1:" + selectedHermes.config.port },
                ]} />
                {selectedHermes.mode === "connect" ? (
                  <p>This connection is managed by its service owner. Model and API settings stay with that Hermes instance.</p>
                ) : (
                  <>
                    <div className="zn-setup__actions">
                      {selectedHermes.running === true && (
                        <button disabled={disabled} onClick={() => void review("stop", selectedHermes.instanceId)}>
                          Review stopping Hermes
                        </button>
                      )}
                      {selectedHermes.running === false && (
                        <button disabled={disabled} onClick={() => void review(selectedHermes.configured ? "start" : "configure", selectedHermes.instanceId)}>
                          {selectedHermes.configured ? "Review starting Hermes" : "Review API configuration"}
                        </button>
                      )}
                    </div>
                    {selectedHermes.running == null && <p role="status">The process state needs a fresh controller check before changing configuration.</p>}
                    {modelBackend(selectedHermes)}
                  </>
                )}
              </>
            ) : (
              <p role="status">The selected Hermes instance is no longer in this controller’s inventory.</p>
            )}
          </>
        ) : undefined}
      />
    );
  }

  return (
    <SetupShell
      step={step}
      onStep={(s) => {
        void navigate(s);
      }}
      busy={busy}
      freshness={
        !snapshot
          ? "Controller unavailable"
          : stale
            ? "Snapshot stale · refresh required"
            : snapshot.busy
              ? "Action running · progress refreshes automatically"
              : "Controller checked " + new Date(fetchedAt).toLocaleTimeString()
      }
      error={connectionError || error}
    >
      <div className="zn-setup__actions">
        <button onClick={() => void refresh()} disabled={busy}>
          Refresh controller
        </button>
        <a href="/legacy">Previous installation controls</a>
      </div>
      {step === "communications" && installDraft && (
        <>
          <SetupIntro title="Install Hermes">
            <p>
              Choose the local instance to install. You can connect a model
              after installation.
            </p>
          </SetupIntro>
          <SetupPanel title="Local installation">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void review();
              }}
            >
              <label>
                Instance name
                <input
                  required
                  maxLength={48}
                  pattern="[a-z][a-z0-9\-]{0,47}"
                  title="Use lowercase letters, numbers and hyphens, starting with a letter."
                  value={installDraft.instanceId}
                  onChange={(e) =>
                    setInstallDraft({
                      ...installDraft,
                      instanceId: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Local API port
                <input
                  type="number"
                  required
                  min={1024}
                  max={65535}
                  value={installDraft.config.port || ""}
                  onChange={(e) =>
                    setInstallDraft({
                      ...installDraft,
                      config: {
                        ...installDraft.config,
                        port: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <button
                type="submit"
                className="zn-setup__primary"
                disabled={disabled}
              >
                Review Hermes installation
              </button>
            </form>
          </SetupPanel>
        </>
      )}
      {step === "communications" && !installDraft && (
        <>
          <SetupIntro eyebrow="STEP 1" title="Connect your conversations.">
            <p>
              Use an existing homeserver or create one. You can set Matrix up
              later and keep using the Hub locally.
            </p>
          </SetupIntro>
          <SetupPanel title={snapshot?.instances.some((i) => ["matrix", "hermes"].includes(i.componentId)) ? "Your connections" : "Find local services"}>
            <p>Saved services show their current status. Discover local services to find another connection.</p>
            <button disabled={disabled} onClick={() => void perform(async () => setCandidates((await action("discover")).candidates))}>
              Discover local services
            </button>
            <ConnectionList items={connectionRows} disabled={disabled}
              onChoose={(row) => chooseConnection(row as CommunicationRow)}
              onManage={(row) => {const target=connectionRows.find(c=>c.id===row.id);if(target?.componentId==="matrix"){window.location.href="/hub?matrix="+encodeURIComponent(target.instanceId||"");}else void navigate("environment");}} />
          </SetupPanel>
          {catalog.filter((c) => c.category === "communications").map(choice)}
          {selection.some(
            (i) => i.componentId === "matrix" && i.mode === "install",
          ) && (
            <SetupPanel title="Prepare Matrix software">
              <p>
                A first installation downloads verified packages and builds the
                pinned Synapse source. Review the compiler prerequisites and
                artifact hashes first. Interrupted preparation retains verified
                downloads for retry.
              </p>
              <button
                disabled={disabled}
                onClick={() => void review("prepare-artifacts")}
              >
                Review Matrix artifact preparation
              </button>
            </SetupPanel>
          )}
          <div className="zn-setup__actions">
            <button
              disabled={disabled || !selection.length}
              onClick={() => void review()}
            >
              Review selected connections / installations
            </button>
            <button
              disabled={disabled}
              onClick={() => void navigate("components")}
            >
              Set Matrix up later / continue →
            </button>
          </div>
        </>
      )}
      {step === "components" && (
        <>
          <SetupIntro eyebrow="STEP 2" title="Choose what belongs here.">
            <p>
              Install selected components locally or connect existing services.
              Package dependencies are disclosed; unrelated services stay
              unselected.
            </p>
          </SetupIntro>
          {catalog.filter((c) => c.category === "work").map(choice)}
          <div className="zn-setup__actions">
            <button
              className="zn-setup__primary"
              disabled={disabled || !selection.length}
              onClick={() => void review()}
            >
              Resolve and review →
            </button>
            <button
              disabled={disabled}
              onClick={() => void navigate("environment")}
            >
              Open environment
            </button>
          </div>
        </>
      )}
      {step === "review" && renderReview()}
      {step === "environment" && hermesTarget && (
        <>
          <SetupIntro
            title={
              selectedHermes?.mode === "connect"
                ? "Hermes connection"
                : selectedHermes?.installed && !selectedHermes.partial
                  ? "Configure Hermes"
                  : "Review Hermes setup"
            }
          />
          {hermesInstances.length > 1 && (
            <label>
              Hermes instance
              <select
                value={hermesTarget}
                onChange={(e) => setHermesTarget(e.target.value)}
              >
                {hermesInstances.map((i) => (
                  <option key={i.instanceId} value={i.instanceId}>
                    {i.instanceId}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedHermes ? (
            <>
              <SetupPanel title={selectedHermes.instanceId}>
                {selectedHermes.mode === "connect" ? (
                  <>
                    <p>
                      The service owner manages this Hermes instance and its
                      model configuration.
                    </p>
                    <StateFacts
                      facts={[
                        {
                          label: "Registered API address",
                          value: selectedHermes.config.endpoint,
                        },
                        {
                          label: "API reachable",
                          value: selectedHermes.stale
                            ? "Unknown"
                            : String(
                                selectedHermes.observation?.reachable ??
                                  "Unknown",
                              ),
                        },
                      ]}
                    />
                  </>
                ) : (
                  <>
                    <StateFacts
                      facts={[
                        {
                          label: "Local API address",
                          value:
                            "http://127.0.0.1:" + selectedHermes.config.port,
                        },
                        {
                          label: "Owned process running",
                          value: String(selectedHermes.running ?? "Unknown"),
                        },
                      ]}
                    />
                    {selectedHermes.partial ? (
                      <button
                        disabled={disabled}
                        onClick={() =>
                          void review("resume-install", hermesTarget)
                        }
                      >
                        Review installation resume
                      </button>
                    ) : selectedHermes.installed !== true ? (
                      <p>
                        The controller could not confirm a complete
                        installation. Check the retained setup state.
                      </p>
                    ) : (
                      selectedHermes.running === true && (
                        <button
                          disabled={disabled}
                          onClick={() => void review("stop", hermesTarget)}
                        >
                          Review stopping Hermes
                        </button>
                      )
                    )}
                  </>
                )}
              </SetupPanel>
              {selectedHermes.mode === "install" &&
                selectedHermes.installed === true &&
                !selectedHermes.partial &&
                modelBackend(selectedHermes)}
            </>
          ) : (
            <p role="status">
              The selected Hermes instance is no longer in this controller’s
              inventory.
            </p>
          )}
          <button
            disabled={busy}
            onClick={() => {
              leaveHermesForm();
              setStep("environment");
            }}
          >
            Open environment
          </button>
        </>
      )}
      {step === "environment" && !hermesTarget && (
        <>
          <SetupIntro
            eyebrow="YOUR ENVIRONMENT"
            title="One place to see what’s here."
          >
            <p>
              Installation, configuration, running processes and service
              readiness are separate observations.
            </p>
          </SetupIntro>
          <div className="zn-setup__actions">
            <button
              disabled={disabled}
              onClick={() => void perform(() => action("refresh"))}
            >
              Observe services
            </button>
            <button
              disabled={disabled}
              onClick={() => void perform(() => action("reconcile"))}
            >
              Reconcile retained state
            </button>
            <button
              disabled={disabled}
              onClick={() => void navigate("components")}
            >
              Add components
            </button>
          </div>
          {!snapshot?.instances.length && (
            <SetupPanel title="Your Hub is ready for choices">
              <p>
                No components have been installed or connected through this
                setup. Existing services remain independent.
              </p>
              <button
                disabled={disabled}
                onClick={() => void navigate("communications")}
              >
                Start with communications
              </button>
            </SetupPanel>
          )}
          {snapshot?.instances.map((i) => {
            const c = catalog.find((c) => c.id === i.componentId);
            return (
              <SetupPanel
                key={i.instanceId}
                title={c?.label + " · " + i.instanceId}
                aside={
                  <button
                    onClick={() =>
                      setDetail(detail === i.instanceId ? null : i.instanceId)
                    }
                  >
                    {detail === i.instanceId ? "Hide details" : "Explore"}
                  </button>
                }
              >
                <StateFacts
                  facts={[
                    {
                      label: "Installation",
                      value:
                        i.mode === "connect"
                          ? "External / not adopted"
                          : String(i.installed ?? "Unknown"),
                    },
                    {
                      label: "Configuration",
                      value: String(i.configured ?? "Unknown"),
                    },
                    {
                      label: "Owned process running",
                      value:
                        i.mode === "connect"
                          ? "Not managed"
                          : String(i.running ?? "Unknown"),
                    },
                    {
                      label: "API reachable",
                      value: i.stale
                        ? "Stale observation"
                        : String(i.observation?.reachable ?? "Not observed"),
                    },
                    {
                      label: "Application ready",
                      value: i.stale
                        ? "Requires a fresh check"
                        : String(
                            i.observation?.applicationReady ?? "Not checked",
                          ),
                    },
                    {
                      label: "Permission / contract",
                      value:
                        (i.observation?.permission || "Not checked") +
                        " / " +
                        (i.observation?.contract || "Not checked"),
                    },
                  ]}
                />
                <p>
                  {i.observation?.error ||
                    (!i.configured
                      ? "Next: configure this instance."
                      : i.running === false
                        ? "Next: start the configured service."
                        : "Use a fresh service observation before relying on readiness.")}
                </p>
                {i.partial && (
                  <p role="status">
                    Installation incomplete. Files and receipts are retained;
                    review a resume before continuing.
                  </p>
                )}
                {i.partial && i.mode === "install" && (
                  <button
                    disabled={disabled}
                    onClick={() => void review("resume-install", i.instanceId)}
                  >
                    Review installation resume
                  </button>
                )}
                {i.mode !== "connect" && (
                  <div className="zn-setup__actions">
                    {["configure", "start", "stop"].map((a) => (
                      <button
                        key={a}
                        disabled={
                          disabled ||
                          i.partial ||
                          (a === "configure" && i.running === true) ||
                          (a === "start" && !i.configured) ||
                          (c?.id === "frank" && a !== "configure")
                        }
                        title={
                          c?.id === "frank"
                            ? "Frank has no standalone HTTP daemon; configure eligible actors separately."
                            : ""
                        }
                        onClick={() => void review(a, i.instanceId)}
                      >
                        {a[0].toUpperCase() + a.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
                {i.componentId === "hermes" &&
                  i.mode !== "connect" &&
                  modelBackend(i)}
                {detail === i.instanceId && (
                  <>
                    <div className="zn-setup__actions">
                      <button
                        disabled={
                          disabled ||
                          i.running !== false ||
                          i.mode === "connect"
                        }
                        onClick={() => void review("backup", i.instanceId)}
                      >
                        Review private backup
                      </button>
                      {i.componentId === "matrix" && i.mode === "install" && (
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void review("enable-network", i.instanceId)
                          }
                        >
                          Review private Tailscale access
                        </button>
                      )}
                    </div>
                    <StateFacts
                      facts={[
                        {
                          label: "Data owner / path",
                          value: i.root
                            ? i.root + "/data"
                            : "External service owns its data",
                        },
                        {
                          label: "Observed",
                          value: i.observation?.observedAt || "Not observed",
                        },
                        {
                          label: "Logs",
                          value: i.root
                            ? i.root + "/logs/service.log (owner-private)"
                            : "Use the service owner’s log interface",
                        },
                        {
                          label: "Ownership",
                          value:
                            i.mode === "connect"
                              ? "Connection only; no stop, upgrade or deletion authority"
                              : "Hub-managed instance",
                        },
                      ]}
                    />
                    <SourceDetails
                      repository={i.source.repository}
                      revision={i.source.commit || i.source.version}
                      schema={c?.configurationSchema}
                    >
                      <p>{c?.description}</p>
                      <p>
                        Package dependencies:{" "}
                        {c?.packageDependencies.join(", ") || "None"}.
                      </p>
                    </SourceDetails>
                  </>
                )}
              </SetupPanel>
            );
          })}
          {snapshot?.operations.slice(-4).map((o: any) => (
            <SetupPanel key={o.id} title={o.action + " · " + o.state}>
              <p role="status">
                {o.outcomeUnknown
                  ? "Controller restarted or operation ownership lost. Outcome unknown; reconcile retained receipts before retrying."
                  : o.state === "applying"
                    ? "Action running. You can leave this page; progress and receipts are retained."
                    : o.error ||
                      "Operation completed; software readiness is shown separately."}
              </p>
              {o.progress?.map((p: any, n: number) => (
                <p key={n}>
                  {p.state?.replaceAll("-", " ")}{" "}
                  {p.completed !== undefined
                    ? `${p.completed} / ${p.total}`
                    : ""}{" "}
                  {p.artifact || ""}
                </p>
              ))}
              {o.state === "reconciliation-required" &&
                o.action === "prepare-artifacts" && (
                  <button
                    disabled={disabled}
                    onClick={() => void review("prepare-artifacts")}
                  >
                    Review preparation retry
                  </button>
                )}
              <details>
                <summary>Retained operation receipt</summary>
                <code>{o.id}</code>
                <p>{o.updatedAt}</p>
              </details>
            </SetupPanel>
          ))}
        </>
      )}
    </SetupShell>
  );
}
