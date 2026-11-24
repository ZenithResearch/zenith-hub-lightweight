"use client";
import { useState, type ReactNode } from "react";
import type {
  HermesBackendSelection,
  HermesModelOptions,
  HermesSignIn,
} from "./HermesModelPicker.js";
import "./HubSetup.css";
import { ZenithCloudScene } from "./ZenithCloudScene.tsx";
export function HermesWelcomeFrame({
  title,
  description,
  children,
  error,
  onRetry,
  embedded = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  error?: string;
  onRetry: () => void;
  embedded?: boolean;
}) {
  if (embedded)
    return (
      <div className="zn-welcome__content">
        {description && (
          <p className="zn-welcome__description">{description}</p>
        )}
        {error && (
          <div role="alert" className="zn-setup__error">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              Retry setup check
            </button>
          </div>
        )}
        {children}
      </div>
    );
  return (
    <main className="zn-welcome">
      <div
        className="zn-welcome__art"
        role="img"
        aria-label="Zenith cloud wordmark"
      >
        <ZenithCloudScene />
      </div>
      <section
        className="zn-setup zn-welcome__panel"
        aria-labelledby="welcome-title"
      >
        <span className="zn-welcome__eyebrow">WELCOME TO ZENITH</span>
        <h1 id="welcome-title">{title}</h1>
        {description && (
          <p className="zn-welcome__description">{description}</p>
        )}
        {error && (
          <div role="alert" className="zn-setup__error">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              Retry setup check
            </button>
          </div>
        )}
        {children}
      </section>
    </main>
  );
}
export function HermesWelcomeReview({
  plan,
  busy,
  onApply,
  onBack,
  onRefresh,
}: {
  plan: any;
  busy: boolean;
  onApply: () => void;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const invalid = plan.invalidated || Date.now() >= plan.expiresAt;
  const item = plan.items[0],
    install = ["install", "resume-install"].includes(plan.action),
    profile = plan.action === "create-guide-profile",
    defaults = profile && plan.defaultConfiguration === true;
  return (
    <>
      <dl className="zn-welcome__facts">
        <dt>
          {profile
            ? defaults
              ? "Configuration"
              : "Guide profile"
            : install
              ? "Install on this Mac"
              : "Hermes model"}
        </dt>
        <dd>
          {profile
            ? defaults
              ? "Hermes default"
              : "hub-guide"
            : install
              ? "Install from the official Nous repository"
              : item.config.modelName}
        </dd>
        <dt>Source repository</dt>
        <dd>
          <a
            href={"https://github.com/" + item.descriptor.source.repository}
            target="_blank"
            rel="noreferrer"
          >
            {item.descriptor.source.repository} ↗
          </a>
        </dd>
        <dt>Private instance</dt>
        <dd>{item.destination}</dd>
        {defaults && <><dt>Default configuration directory</dt><dd>{item.guideBinding.configurationHome}</dd></>}
        {!install && !profile && (
          <>
            <dt>Model connection</dt>
            <dd>
              {item.config.providerId === "llamacpp"
                ? "Open model on this Mac"
                : item.config.modelEndpoint || item.config.providerId}
            </dd>
          </>
        )}
        {item.runtimePins?.localModel && (
          <>
            <dt>Download / free space needed</dt>
            <dd>
              {(item.runtimePins.localModel.downloadBytes / 1024 ** 3).toFixed(
                1,
              )}{" "}
              /{" "}
              {(item.runtimePins.localModel.requiredBytes / 1024 ** 3).toFixed(
                1,
              )}{" "}
              GB
            </dd>
          </>
        )}
      </dl>
      <p>
        {profile
          ? defaults
            ? "Uses the installed Hermes default configuration. Choose its model provider next."
            : "Uses the installed Hermes software and creates a dedicated Hub guide. Model configuration comes next."
          : install
            ? "Installs the software and its managed runtime. Model selection comes next."
            : "Saves this configuration and starts Hermes. Your first chat is sent only when you choose."}
      </p>
      {invalid && (
        <p role="status">
          This review needs to be refreshed before you apply it.
        </p>
      )}
      {!!item.prerequisites.length && (
        <div role="alert" className="zn-setup__error">
          {item.prerequisites.map((p: string) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      <details>
        <summary>
          {install ? "Installation details" : "Configuration details"}
        </summary>
        <p>
          Source: {item.descriptor.source.repository} ·{" "}
          {item.descriptor.source.commit}
        </p>
        <p>API: 127.0.0.1:{item.config.port}</p>
        {item.effects.map((p: string) => (
          <p key={p}>{p}</p>
        ))}
        <pre>
          {JSON.stringify(
            {
              bootstrap: item.bootstrap,
              runtime: item.runtimePins,
              expiresAt: new Date(plan.expiresAt).toISOString(),
            },
            null,
            2,
          )}
        </pre>
      </details>
      <div className="zn-setup__actions">
        <button
          className="zn-setup__primary"
          type="button"
          disabled={busy}
          onClick={
            invalid || item.prerequisites.length > 0 ? onRefresh : onApply
          }
        >
          {busy
            ? "Checking…"
            : invalid
              ? "Recheck setup"
              : item.prerequisites.length > 0
                ? "Check requirements again"
                : profile
                  ? defaults
                    ? "Use default configuration"
                    : "Create guide profile"
                  : install
                    ? "Install Hermes"
                    : plan.action === "start"
                      ? "Start Hermes"
                      : "Set up Hermes"}
        </button>
        <button type="button" disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}
export function HermesWelcomeProgress({
  operation,
  onReconcile,
  onPauseResume,
  busy,
}: {
  operation: any;
  busy: boolean;
  onReconcile?: () => void;
  onPauseResume?: (job: any) => void;
}) {
  const phases: Record<string, string> = {
    "preparing-source": "Preparing Hermes source",
    "preparing-runtime-python": "Preparing Python",
    "preparing-runtime-uv": "Preparing build tools",
    "building-frozen-environment": "Building Hermes",
    "preparing-required-tools": "Preparing Hermes tools",
    "verifying-installation": "Verifying installation",
    "checking-api": "Checking the Hermes API",
    configuring: "Saving configuration",
    stopping: "Stopping Hermes to apply changes",
    "preparing-model": "Preparing your model",
    starting: "Starting Hermes",
    started: "Checking Hermes",
  };
  const job = operation.progress?.find((p: any) => p.jobId),
    phase =
      operation.phase ||
      operation.progress?.find((p: any) => p.phase || p.state)?.phase ||
      operation.progress?.[0]?.state;
  return (
    <>
      <p role="status">
        {phases[phase] ||
          phase?.replaceAll("-", " ") ||
          "Preparing the installer…"}
      </p>
      {!onReconcile && (
        <progress
          aria-label="Hermes setup progress"
          {...(job?.total > 0
            ? { value: job.completed || 0, max: job.total }
            : {})}
        />
      )}
      {job?.total > 0 && (
        <p>
          {((job.completed || 0) / 1024 ** 3).toFixed(1)} of{" "}
          {(job.total / 1024 ** 3).toFixed(1)} GB · {job.jobState}
        </p>
      )}
      {onPauseResume && (job?.canPause || job?.canResume) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPauseResume(job)}
        >
          {job.canResume ? "Resume download" : "Pause download"}
        </button>
      )}
      <p>
        Your progress is saved. You can reload this page without starting
        another installation.
      </p>
      {onReconcile && (
        <>
          <p>
            {operation.error ||
              "The Hub needs to check the retained operation before continuing."}
          </p>
          <button
            type="button"
            className="zn-setup__primary"
            disabled={busy}
            onClick={onReconcile}
          >
            Check retained progress
          </button>
        </>
      )}
      <details>
        <summary>Operation details</summary>
        <p>
          {operation.action} · {operation.id}
        </p>
        {operation.errorCode && (
          <p>{operation.errorCode.replaceAll("_", " ")}</p>
        )}
      </details>
    </>
  );
}
export type WelcomeConnectionMode = "provider" | "local" | "server" | null;
export function HermesWelcomeModel({
  mode,
  options,
  value,
  models,
  signIn,
  loading,
  disabled,
  onMode,
  onChange,
  onKey,
  onSignIn,
  onPoll,
  onCancelSignIn,
  onLoadModels,
  onReview,
  onRefreshOptions,
}: {
  mode: WelcomeConnectionMode;
  options?: HermesModelOptions;
  value: HermesBackendSelection;
  models: string[];
  signIn?: HermesSignIn;
  loading: boolean;
  disabled: boolean;
  onMode: (m: WelcomeConnectionMode) => void;
  onChange: (p: Partial<HermesBackendSelection>) => void;
  onKey: (key: string) => Promise<void>;
  onSignIn: () => void;
  onPoll: () => void;
  onCancelSignIn: () => void;
  onLoadModels: () => void;
  onReview: () => void;
  onRefreshOptions: () => void;
}) {
  const [key, setKey] = useState("");
  const provider = options?.providers.find((p) => p.id === value.providerId);
  const recommended = options?.localModels.find((m) => m.recommended);
  const local = options?.localModels.find((m) => m.id === value.localModelId);
  const selectLocal = (
    m: NonNullable<HermesModelOptions["localModels"]>[number],
  ) =>
    onChange({
      providerId: "llamacpp",
      backendKind: "local",
      localModelId: m.id,
      modelName: m.modelName,
      contextLength: m.contextLength,
    });
  const modelInput = (
    <>
      <label>
        Model for Hermes
        <select
          disabled={disabled || loading || !models.length}
          value={value.modelName || ""}
          onChange={(e) => onChange({ modelName: e.target.value })}
        >
          <option value="">Choose a model</option>
          {value.modelName && !models.includes(value.modelName) && (
            <option value={value.modelName}>{value.modelName}</option>
          )}
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <p className="zn-welcome__note">
        This is the model Hermes will use to answer you.
      </p>
      <button
        type="button"
        disabled={
          disabled || loading || (mode === "server" && !value.modelEndpoint)
        }
        onClick={onLoadModels}
      >
        {mode === "server" ? "Check server and load models" : "Refresh models"}
      </button>
      <details>
        <summary>Advanced model settings</summary>
        <label>
          Model ID
          <input
            value={value.modelName || ""}
            disabled={disabled}
            onChange={(e) => onChange({ modelName: e.target.value })}
          />
        </label>
        {mode === "server" && (
          <>
            <label>
              Served context window (optional)
              <input
                type="number"
                min={64000}
                value={value.contextLength || ""}
                onChange={(e) =>
                  onChange({
                    contextLength: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
              />
            </label>
            <label>
              Saved server credential reference (optional)
              <input
                value={value.secretRef || ""}
                onChange={(e) =>
                  onChange({ secretRef: e.target.value || undefined })
                }
              />
            </label>
          </>
        )}
      </details>
    </>
  );
  return (
    <>
      {!mode ? (
        <div className="zn-welcome__choices">
          {(
            [
              [
                "provider",
                "Use an AI provider",
                "Sign in or connect with an API key.",
              ],
              [
                "local",
                "Run an open model on this Mac",
                "Choose a model that fits this machine.",
              ],
              [
                "server",
                "Connect a model server",
                "Use an existing server you manage.",
              ],
            ] as const
          ).map(([m, t, d]) => (
            <button
              type="button"
              key={m}
              disabled={disabled}
              onClick={() => onMode(m)}
            >
              <strong>{t}</strong>
              <span>{d}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="zn-welcome__text-button"
            disabled={disabled}
            onClick={() => {
              setKey("");
              onMode(null);
            }}
          >
            ← Change connection type
          </button>
          {loading && <p role="status">Checking Hermes…</p>}
          {!options && mode !== "server" && (
            <button
              type="button"
              disabled={disabled || loading}
              onClick={onRefreshOptions}
            >
              Load connection options
            </button>
          )}
          {mode === "provider" && options && (
            <>
              <label>
                Hermes provider
                <select
                  value={value.providerId || ""}
                  disabled={disabled}
                  onChange={(e) => {
                    setKey("");
                    onChange({
                      providerId: e.target.value,
                      backendKind: "remote",
                      modelName: "",
                      modelEndpoint: undefined,
                      contextLength: undefined,
                      localModelId: undefined,
                      secretRef: undefined,
                    });
                  }}
                >
                  <option value="">Choose a provider</option>
                  {options.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {provider && (
                <>
                  <p>{provider.description}</p>
                  <p role="status">
                    {provider.signedIn
                      ? "Signed in with Hermes."
                      : provider.credentialConfigured
                        ? "Credentials saved. Verify the connection with your first chat."
                        : "Connect your provider to choose a model."}
                  </p>
                  {provider.supportsSignIn && !provider.signedIn && (
                    <button
                      type="button"
                      disabled={disabled || loading}
                      onClick={onSignIn}
                    >
                      Sign in with {provider.name}
                    </button>
                  )}
                  {provider.supportsApiKey && (
                    <details
                      key={provider.id}
                      open={
                        !provider.supportsSignIn &&
                        !provider.credentialConfigured
                      }
                    >
                      <summary>
                        {provider.credentialConfigured
                          ? "Replace API key"
                          : "Use an API key"}
                      </summary>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const secret = key;
                          setKey("");
                          await onKey(secret);
                        }}
                      >
                        <label>
                          Provider API key
                          <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={disabled || loading}
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                          />
                        </label>
                        <p className="zn-welcome__note">
                          Saved privately by Hermes; excluded from browser
                          drafts and reviews.
                        </p>
                        <button
                          disabled={disabled || loading || !key.trim()}
                          type="submit"
                        >
                          Save provider key
                        </button>
                      </form>
                    </details>
                  )}
                  {!provider.supportsApiKey && !provider.supportsSignIn && (
                    <p>
                      This provider requires its native external setup. Choose
                      another provider here or refresh after completing it.
                    </p>
                  )}
                  {signIn?.providerId === provider.id &&
                    signIn.status !== "approved" &&
                    !provider.signedIn && (
                      <div className="zn-welcome__signin">
                        <a
                          href={signIn.verification_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open provider sign-in ↗
                        </a>
                        {signIn.user_code && (
                          <p>
                            Enter code: <strong>{signIn.user_code}</strong>
                          </p>
                        )}
                        <p>Sign-in: {signIn.status || "pending"}</p>
                        <button
                          type="button"
                          disabled={disabled || loading}
                          onClick={onPoll}
                        >
                          Check sign-in
                        </button>
                        <button
                          type="button"
                          disabled={disabled || loading}
                          onClick={onCancelSignIn}
                        >
                          Cancel sign-in
                        </button>
                      </div>
                    )}
                  {provider.credentialConfigured && modelInput}
                </>
              )}
            </>
          )}
          {mode === "local" && options && (
            <>
              <p>
                Hermes checks memory and free disk before downloading. Nothing
                downloads until you apply the review.
              </p>
              {[local || recommended].filter(Boolean).map(
                (m) =>
                  m && (
                    <div key={m.id} className="zn-welcome__model">
                      <strong>
                        {m.name}
                        {m.recommended ? " · Suggested for this Mac" : ""}
                      </strong>
                      <p>
                        {m.machineLabel} ·{" "}
                        {(m.downloadBytes / 1024 ** 3).toFixed(1)} GB download
                      </p>
                      <p>{m.fitSummary}</p>
                      <button
                        type="button"
                        disabled={disabled || !m.fits}
                        onClick={() => selectLocal(m)}
                      >
                        {value.localModelId === m.id
                          ? "Selected"
                          : "Choose this model"}
                      </button>
                    </div>
                  ),
              )}
              {!recommended && !local && (
                <p>
                  No suggested model fits the current memory budget. Choose a
                  provider or an existing model server.
                </p>
              )}
              <details>
                <summary>Choose another model</summary>
                {options.localModels.map((m) => (
                  <div key={m.id} className="zn-welcome__model">
                    <strong>
                      {m.tier} · {m.name}
                    </strong>
                    <p>
                      {m.machineLabel} ·{" "}
                      {(m.downloadBytes / 1024 ** 3).toFixed(1)} GB download ·{" "}
                      {m.fitSummary}
                    </p>
                    <button
                      type="button"
                      disabled={disabled || !m.fits}
                      onClick={() => selectLocal(m)}
                    >
                      Choose {m.name}
                    </button>
                  </div>
                ))}
              </details>
            </>
          )}
          {mode === "server" && (
            <>
              <label>
                Model server address
                <input
                  placeholder="http://127.0.0.1:11434"
                  value={value.modelEndpoint || ""}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      providerId: "custom",
                      modelEndpoint: e.target.value,
                      modelName: "",
                      secretRef: undefined,
                      backendKind: e.target.value.startsWith("https:")
                        ? "remote"
                        : "local",
                    })
                  }
                />
              </label>
              <p className="zn-welcome__note">
                Use the server origin without /v1. Hermes requires at least
                64,000 tokens of context actually served by the model.
              </p>
              {modelInput}
            </>
          )}
          <div className="zn-setup__actions">
            <button
              type="button"
              className="zn-setup__primary"
              disabled={
                disabled ||
                loading ||
                !value.modelName ||
                (mode === "provider" && !provider?.credentialConfigured) ||
                (mode === "local" && !local?.fits)
              }
              onClick={onReview}
            >
              Review Hermes setup
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function HermesWelcomeProfiles({
  installations,
  installationId,
  templateId,
  managed,
  busy,
  onInstallation,
  onTemplate,
  onContinue,
}: {
  installations: any[];
  installationId: string;
  templateId: string;
  managed: boolean;
  busy: boolean;
  onInstallation: (id: string) => void;
  onTemplate: (id: string) => void;
  onContinue: () => void;
}) {
  const selected = installations.find((i) => i.id === installationId);
  return (
    <>
      <p role="status">Hermes is installed on this Mac.</p>
      <p>
        Create the Hub’s own <strong>hub-guide</strong> profile, then choose how
        it answers. Its conversations and configuration belong to this Hub.
      </p>
      {!managed && installations.length > 1 && (
        <label>
          Hermes installation
          <select
            value={installationId}
            disabled={busy}
            onChange={(e) => onInstallation(e.target.value)}
          >
            {installations.map((i) => (
              <option value={i.id} key={i.id}>
                {i.commit ? i.commit.slice(0, 7) + " · " : ""}
                {i.source || i.launcher}
              </option>
            ))}
          </select>
        </label>
      )}
      {!managed && selected?.reason && (
        <p role="alert" className="zn-setup__error">
          {selected.reason}
        </p>
      )}
      {!managed && selected?.compatible && (
        <label>
          Starting model settings
          <select
            value={templateId}
            disabled={busy}
            onChange={(e) => onTemplate(e.target.value)}
          >
            <option value="">Configure a new guide profile</option>
            {selected.profiles.map((p: any) => (
              <option key={p.id} value={p.id}>
                Use model settings from {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {templateId && (
        <p>
          Only the model selection is reused. You’ll sign in separately for the
          Hub guide; credentials and conversations are not copied.
        </p>
      )}
      <button
        type="button"
        className="zn-setup__primary"
        disabled={busy || (!managed && !selected?.compatible)}
        onClick={onContinue}
      >
        {busy ? "Checking…" : "Create guide profile"}
      </button>
    </>
  );
}
