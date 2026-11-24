"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HermesSetupLanding } from "@/vendor/zenith-ui/HubSetup/HubSetup";
import {
  HermesWelcomeFrame,
  HermesWelcomeReview,
  HermesWelcomeProgress,
  HermesWelcomeModel,
  type WelcomeConnectionMode,
} from "@/vendor/zenith-ui/HubSetup/HermesWelcome";
import type {
  HermesBackendSelection,
  HermesModelOptions,
} from "@/vendor/zenith-ui/HubSetup/HermesModelPicker";
import {
  welcomeState,
  welcomeLandingState,
} from "@/lib/setup/welcome-state.mjs";
import {
  withSuggestedModel,
  withDefaultConfiguration,
  modelChoiceKey,
} from "@/lib/setup/model-choice.mjs";

export function HermesWelcomePage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<any>(null),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState<string>(),
    [plan, setPlan] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [instanceName, setInstanceName] = useState("hermes-local"),
    [port, setPort] = useState<number>();
  const [installationId, setInstallationId] = useState("");
  const [mode, setMode] = useState<WelcomeConnectionMode>(null),
    [value, setValue] = useState<HermesBackendSelection>({});
  const [options, setOptions] = useState<HermesModelOptions>(),
    [modelLoading, setModelLoading] = useState(false),
    [catalogs, setCatalogs] = useState<Record<string, any>>({});
  const [freshAt, setFreshAt] = useState(0),
    [now, setNow] = useState(Date.now());
  const mounted = useRef(false),
    latest = useRef<any>(null),
    currentRead = useRef<AbortController | null>(null),
    expandedRef = useRef(false),
    applied = useRef<{ id: string; action: string } | null>(null);
  const draft = useRef(value),
    loaded = useRef(""),
    requested = useRef(new Set<string>()),
    hydrated = useRef("");
  function receive(next: any) {
    if (!mounted.current || !Array.isArray(next.instances)) return;
    if (
      latest.current?.csrf === next.csrf &&
      next.revision < latest.current.revision
    )
      return;
    latest.current = next;
    setPlan((current: any) =>
      current?.action === "install" &&
      next.hermesInstallations?.some((i: any) => i.compatible)
        ? null
        : current &&
            (current.revision !== next.revision ||
              current.controllerSession !== next.csrf)
          ? { ...current, invalidated: true }
          : current,
    );
    setSnapshot(next);
    setFreshAt(Date.now());
    window.dispatchEvent(
      new CustomEvent("zenith:hub-setup-snapshot", { detail: next }),
    );
  }
  async function refresh() {
    if (currentRead.current) return;
    const abort = new AbortController();
    currentRead.current = abort;
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/setup", {
        cache: "no-store",
        signal: abort.signal,
      });
      const next = await response.json();
      if (!response.ok || next.mode !== "local")
        throw Error(
          "Setup check failed: " +
            (next.error || "guided setup disabled").replaceAll("_", " "),
        );
      if (currentRead.current === abort) {
        receive(next);
        setConnectionError("");
      }
    } catch (e) {
      if (mounted.current && currentRead.current === abort)
        setConnectionError(
          (e as Error).name === "AbortError"
            ? "The Hub check timed out. Your work is retained; retry the check."
            : (e as Error).message,
        );
    } finally {
      clearTimeout(timer);
      if (currentRead.current === abort) currentRead.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = setInterval(() => void refresh(), 4000),
      tick = setInterval(() => setNow(Date.now()), 1000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("zenith:hub-setup-refresh", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(tick);
      const pending = currentRead.current;
      currentRead.current = null;
      pending?.abort();
      window.removeEventListener("focus", focus);
      window.removeEventListener("zenith:hub-setup-refresh", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, []);
  const state = welcomeState(snapshot, targetId || snapshot?.welcomeTargetId),
    instance = state.instance;
  const stale = !freshAt || now - freshAt > 30000,
    disabled = busy || stale || snapshot?.busy === true;
  async function action(
    operation: string,
    fields: Record<string, unknown> = {},
  ) {
    const current = latest.current;
    if (!current?.csrf)
      throw Error("Check the Hub connection before continuing.");
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zenith-CSRF": current.csrf,
      },
      body: JSON.stringify({
        schema: "zenith.hub-setup-action.v1",
        operation,
        ...fields,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const next = await response.json();
    if (!response.ok)
      throw Error(
        next.error
          ? next.error.replaceAll("_", " ")
          : "The action could not be completed. Check retained progress before retrying.",
      );
    receive(next);
    return next;
  }
  async function run(task: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      return await task();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function change(patch: Partial<HermesBackendSelection>) {
    setValue((current) => {
      const next = { ...current, ...patch };
      draft.current = next;
      return next;
    });
  }
  const key =
    snapshot?.root && instance ? snapshot.root + "/" + instance.instanceId : "";
  useEffect(() => {
    if (!key || hydrated.current === key) return;
    hydrated.current = key;
    let saved: any = null;
    try {
      saved = JSON.parse(
        sessionStorage.getItem("zenith.hermes.welcome.draft") || "null",
      );
    } catch {}
    const retained =
      state.operation?.state === "retryable"
        ? state.operation.requestedBackend
        : undefined;
    const initial =
      saved?.key === key ? saved.value : retained || instance.config;
    setValue(initial || {});
    draft.current = initial || {};
    setMode(
      saved?.key === key
        ? saved.mode
        : initial?.modelName
          ? initial.providerId === "llamacpp"
            ? "local"
            : initial.providerId === "custom" || !initial.providerId
              ? "server"
              : "provider"
          : null,
    );
    setOptions(undefined);
    setCatalogs({});
    loaded.current = "";
    requested.current.clear();
  }, [key]);
  useEffect(() => {
    if (!key || hydrated.current !== key) return;
    try {
      sessionStorage.setItem(
        "zenith.hermes.welcome.draft",
        JSON.stringify({ key, mode, value }),
      );
    } catch {}
  }, [key, mode, value]);
  async function modelRequest(request: Record<string, unknown>) {
    if (!instance) return;
    setModelLoading(true);
    try {
      const result = await action("hermes-model", {
        instanceId: instance.instanceId,
        modelRequest: request,
      });
      return result.data;
    } finally {
      if (mounted.current) setModelLoading(false);
    }
  }
  async function loadOptions() {
    const data = await modelRequest({ action: "options" });
    if (data) {
      setOptions(data);
      // Keep an in-progress choice; hydrate only an untouched form from Hermes's main model slot.
      const initial = withDefaultConfiguration(draft.current, data.configuration);
      if (initial !== draft.current) {
        change(initial);
        setMode(initial.providerId === "llamacpp" ? "local" : initial.providerId === "custom" ? "server" : "provider");
      }
    }
    return data;
  }
  async function loadModels(selection = draft.current) {
    const choice = { ...selection },
      catalogKey = modelChoiceKey(instance.instanceId, choice);
    const data = await modelRequest(
      choice.providerId === "custom"
        ? { action: "endpoint-models", endpoint: choice.modelEndpoint, ...(choice.secretRef ? { secretRef: choice.secretRef } : {}) }
        : { action: "models", providerId: choice.providerId },
    );
    if (data) {
      setCatalogs((all) => ({ ...all, [catalogKey]: data }));
      setValue((current) => {
        const next = withSuggestedModel(current, choice, data);
        draft.current = next;
        return next;
      });
    }
  }
  useEffect(() => {
    if (
      !editing ||
      !key ||
      !instance?.installed ||
      instance.partial ||
      loaded.current === key ||
      state.phase === "working" ||
      state.phase === "reconcile"
    )
      return;
    loaded.current = key;
    void run(loadOptions);
  }, [key, instance?.installed, instance?.partial, state.phase, editing]);
  const provider = options?.providers.find((p) => p.id === value.providerId);
  useEffect(() => {
    if (
      !instance ||
      mode !== "provider" ||
      !provider?.credentialConfigured ||
      modelLoading
    )
      return;
    const catalogKey = modelChoiceKey(instance.instanceId, value);
    if (requested.current.has(catalogKey)) return;
    requested.current.add(catalogKey);
    void run(() => loadModels(value));
  }, [
    instance?.instanceId,
    mode,
    provider?.id,
    provider?.credentialConfigured,
    modelLoading,
  ]);
  async function review(actionName: string) {
    await run(async () => {
      const fields: Record<string, unknown> = {
        action: actionName,
        welcome: true,
        expectedRevision: latest.current.revision,
      };
      if (instance) fields.instanceId = instance.instanceId;
      else
        fields.selection = [
          {
            componentId: "hermes",
            instanceId: instanceName,
            mode: "install",
            config: port ? { port } : {},
          },
        ];
      if (actionName === "setup-hermes") fields.backend = draft.current;
      if (actionName === "create-guide-profile" && !instance) {
        fields.installationId =
          installationId ||
          snapshot.hermesInstallations?.find((i: any) => i.compatible)?.id ||
          snapshot.hermesInstallations?.[0]?.id;
        fields.defaultConfiguration = true;
      }
      const result = await action("plan", fields);
      if (!expandedRef.current) {
        void action("cancel", { planId: result.plan.id }).catch(() => {});
        return;
      }
      setPlan({ ...result.plan, controllerSession: latest.current.csrf });
    });
  }
  async function apply() {
    await run(async () => {
      const chosen = plan;
      await action("apply", { planId: chosen.id, background: true });
      applied.current = { id: chosen.id, action: chosen.action };
      setPlan(null);
      setEditing(
        chosen.action === "create-guide-profile" && expandedRef.current,
      );
    });
  }
  function closeExpanded() {
    expandedRef.current = false;
    setExpanded(false);
    setEditing(false);
    const reviewPlan = plan;
    setPlan(null);
    if (reviewPlan)
      void action("cancel", { planId: reviewPlan.id }).catch(() => {});
  }
  function openExpanded(configure = false) {
    expandedRef.current = true;
    setExpanded(true);
    setEditing(configure);
    if (state.phase === "install") void review("install");
  }
  useEffect(() => {
    const pending = applied.current;
    if (!pending) return;
    const operation = snapshot?.operations?.find(
      (o: any) => o.id === pending.id,
    );
    if (operation?.state !== "complete") return;
    applied.current = null;
    if (pending.action === "create-guide-profile") {
      if (expandedRef.current) setEditing(true);
    } else {
      expandedRef.current = false;
      setExpanded(false);
      setEditing(false);
    }
  }, [snapshot, plan]);
  const phase = plan
    ? "review"
    : editing &&
        instance?.installed &&
        ["ready", "start", "connecting"].includes(state.phase)
      ? "model"
      : state.phase;
  const titles: Record<string, string> = {
    checking: "Checking Hermes…",
    install: "Your Hub starts with Hermes",
    installation: "Connect installed Hermes",
    resume: "Continue installing Hermes",
    "choose-instance": "Choose your Hermes installation",
    review:
      plan?.action === "create-guide-profile"
        ? "Use Hermes default configuration"
        : ["install", "resume-install"].includes(plan?.action)
          ? "Install Hermes from source"
          : "Set up Hermes",
    working: ["install", "resume-install"].includes(state.operation?.action)
      ? "Installing Hermes"
      : "Setting up Hermes",
    reconcile: "Check retained progress",
    model: "How should Hermes answer?",
    start: "Start your Hermes",
    connecting: "Check the Hermes connection",
    ready: instance?.welcomeEnteredAt
      ? "Welcome to your Hub"
      : "Hermes is ready",
  };
  const landing = welcomeLandingState(snapshot, state);
  const content = (
    <HermesWelcomeFrame
      embedded
      title={titles[phase] || "Welcome"}
      description={
        phase === "install"
          ? "Hermes helps you set up and use your Hub. First, install it on this Mac."
          : phase === "model"
            ? "Hermes needs a model to answer you. Choose a connection to get started."
            : undefined
      }
      error={
        connectionError ||
        error ||
        (snapshot && stale
          ? "The Hub check is out of date. Recheck before continuing."
          : "")
      }
      onRetry={() => {
        setError("");
        void refresh();
      }}
    >
      {phase === "checking" && <p role="status">Connecting to this Hub…</p>}
      {instance &&
        state.instances.length > 1 &&
        !["working", "reconcile", "review"].includes(phase) && (
          <label>
            Hermes installation
            <select
              value={instance.instanceId}
              disabled={disabled}
              onChange={(e) =>
                void run(async () => {
                  const id = e.target.value;
                  await action("select-hermes", {
                    instanceId: id,
                    expectedRevision: latest.current.revision,
                  });
                  setTargetId(id);
                  closeExpanded();
                })
              }
            >
              {state.instances.map((i: any) => (
                <option key={i.instanceId} value={i.instanceId}>
                  {i.instanceId}
                </option>
              ))}
            </select>
          </label>
        )}
      {phase === "choose-instance" && (
        <div className="zn-welcome__choices">
          {state.instances.map((i: any) => (
            <button
              type="button"
              key={i.instanceId}
              onClick={() =>
                void run(async () => {
                  await action("select-hermes", {
                    instanceId: i.instanceId,
                    expectedRevision: latest.current.revision,
                  });
                  setTargetId(i.instanceId);
                  closeExpanded();
                })
              }
            >
              {i.instanceId}
            </button>
          ))}
        </div>
      )}
      {phase === "installation" && (
        <>
          <p>Choose the installed Hermes software to configure its default model provider.</p>
          <label>
            Hermes installation
            <select
              value={installationId || snapshot.hermesInstallations?.find((i: any) => i.compatible)?.id || snapshot.hermesInstallations?.[0]?.id || ""}
              disabled={disabled}
              onChange={(e) => setInstallationId(e.target.value)}
            >
              {(snapshot.hermesInstallations || []).map((i: any) => (
                <option key={i.id} value={i.id} disabled={!i.compatible}>
                  {i.source || i.launcher}{!i.compatible ? " · incompatible" : ""}
                </option>
              ))}
            </select>
          </label>
          {snapshot.hermesInstallations?.filter((i: any) => !i.compatible).map((i: any) => <p key={i.id}>{i.reason}</p>)}
          <button type="button" className="zn-setup__primary" disabled={disabled || !snapshot.hermesInstallations?.some((i: any) => i.compatible)} onClick={() => void review("create-guide-profile")}>
            Use default configuration
          </button>
        </>
      )}
      {phase === "install" && (
        <>
          <p>
            Build the release-pinned Hermes source in its own private instance.
            Configuration comes next.
          </p>
          <dl className="zn-welcome__facts">
            <dt>Source</dt>
            <dd>
              {
                snapshot.catalog.components.find((c: any) => c.id === "hermes")
                  ?.source.repository
              }
            </dd>
            <dt>Destination</dt>
            <dd>
              {snapshot.root}/instances/{instanceName}
            </dd>
          </dl>
          <button
            type="button"
            className="zn-setup__primary"
            disabled={disabled}
            onClick={() => void review("install")}
          >
            Install Hermes
          </button>
          <details>
            <summary>Installation options</summary>
            <label>
              Instance name
              <input
                disabled={disabled}
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
              />
            </label>
            <label>
              Private API port
              <input
                type="number"
                min={1024}
                max={65535}
                value={port || ""}
                placeholder="Choose automatically"
                disabled={disabled}
                onChange={(e) =>
                  setPort(e.target.value ? Number(e.target.value) : undefined)
                }
              />
            </label>
            <p>
              The installer prepares its own pinned runtime; no existing Hermes
              profile or account is copied.
            </p>
          </details>
        </>
      )}
      {phase === "resume" && (
        <>
          <p>
            Your incomplete installation is retained. Review its source and
            requirements before resuming.
          </p>
          <button
            type="button"
            className="zn-setup__primary"
            disabled={disabled}
            onClick={() => void review("resume-install")}
          >
            Review installation resume
          </button>
        </>
      )}
      {phase === "review" && (
        <HermesWelcomeReview
          plan={plan}
          busy={busy}
          onApply={() => void apply()}
          onRefresh={() => void review(plan.action)}
          onBack={() =>
            void run(async () => {
              await action("cancel", { planId: plan.id });
              setPlan(null);
            })
          }
        />
      )}
      {(phase === "working" || phase === "reconcile") && (
        <HermesWelcomeProgress
          operation={state.operation}
          busy={busy}
          onReconcile={
            phase === "reconcile"
              ? () =>
                  void run(async () => {
                    await action("reconcile");
                  })
              : undefined
          }
          onPauseResume={(job) =>
            void run(() =>
              modelRequest({
                action: job.canResume ? "local-resume" : "local-pause",
                jobId: job.jobId,
              }),
            )
          }
        />
      )}
      {phase === "model" && (
        <>
          <HermesWelcomeModel
            key={key}
            mode={mode}
            options={options}
            value={value}
            models={
              instance
                ? catalogs[modelChoiceKey(instance.instanceId, value)]
                    ?.models || []
                : []
            }
            loading={modelLoading}
            disabled={disabled}
            signIn={instance?.providerSignIn}
            onMode={(m) => {
              setMode(m);
              change({
                providerId:
                  m === "server"
                    ? "custom"
                    : m === "local"
                      ? "llamacpp"
                      : undefined,
                modelName: "",
                modelEndpoint: undefined,
                localModelId: undefined,
                contextLength: undefined,
                secretRef: undefined,
              });
            }}
            onChange={change}
            onRefreshOptions={() => void run(loadOptions)}
            onLoadModels={() => void run(() => loadModels())}
            onKey={async (apiKey) => {
              await run(async () => {
                await modelRequest({
                  action: "connect-key",
                  providerId: value.providerId,
                  apiKey,
                });
                await loadOptions();
                await loadModels();
              });
            }}
            onSignIn={() =>
              void run(() =>
                modelRequest({
                  action: "oauth-start",
                  providerId: value.providerId,
                }),
              )
            }
            onPoll={() =>
              void run(async () => {
                const login = instance.providerSignIn;
                const result = await modelRequest({
                  action: "oauth-poll",
                  providerId: login.providerId,
                  sessionId: login.session_id,
                });
                if (result.status === "approved") {
                  await loadOptions();
                  await loadModels();
                }
              })
            }
            onCancelSignIn={() =>
              void run(() =>
                modelRequest({
                  action: "oauth-cancel",
                  sessionId: instance.providerSignIn.session_id,
                }),
              )
            }
            onReview={() => void review("setup-hermes")}
          />
          {editing && (
            <button type="button" disabled={disabled} onClick={closeExpanded}>
              Keep current configuration
            </button>
          )}
        </>
      )}
      {phase === "start" && (
        <>
          <p>
            Your configuration is saved. Start Hermes to use{" "}
            {instance.config.modelName}.
          </p>
          <button
            type="button"
            className="zn-setup__primary"
            disabled={disabled}
            onClick={() => void review("start")}
          >
            Start Hermes
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            Change configuration
          </button>
        </>
      )}
      {phase === "connecting" && (
        <>
          <p>
            Hermes is running, but its API has not responded yet. Your
            configuration is saved.
          </p>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            Check connection
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            Configure
          </button>
        </>
      )}
      {editing &&
        !["working", "reconcile", "review", "model"].includes(phase) && (
          <button type="button" disabled={disabled} onClick={closeExpanded}>
            Back
          </button>
        )}
    </HermesWelcomeFrame>
  );
  return (
    <HermesSetupLanding
      state={connectionError ? "unavailable" : landing.state}
      primaryLabel={landing.label}
      continueDisabled={
        busy ||
        stale ||
        (snapshot?.busy === true && landing.state !== "recover")
      }
      onContinue={() => {
        if (
          landing.state !== "configure" ||
          state.phase === "choose-instance"
        ) {
          openExpanded(state.phase === "choose-instance");
          return;
        }
        void run(async () => {
          await action("finish-welcome", {
            expectedRevision: latest.current.revision,
            ...(instance ? { instanceId: instance.instanceId } : {}),
          });
          router.push("/hub");
        });
      }}
      onConfigure={
        landing.installed && instance?.mode !== "connect"
          ? () => openExpanded(true)
          : undefined
      }
      statusMessage={error || landing.status}
      unavailableReason={connectionError}
      onRetry={() => {
        setError("");
        void refresh();
      }}
      expanded={expanded}
      configuration={expanded ? content : undefined}
      configurationTitle={titles[phase] || "Hermes setup"}
      onCloseConfiguration={closeExpanded}
      onGuideHost={(host) =>
        window.dispatchEvent(
          new CustomEvent("zenith:hermes-guide-host", { detail: { host } }),
        )
      }
    />
  );
}
