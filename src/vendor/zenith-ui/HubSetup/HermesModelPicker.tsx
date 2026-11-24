"use client";
import { useEffect, useRef, useState } from "react";
import "./HubSetup.css";

export type HermesBackendSelection = {
  providerId?: string;
  backendKind?: string;
  modelName?: string;
  modelEndpoint?: string;
  contextLength?: number;
  localModelId?: string;
  secretRef?: string;
};
export type HermesModelOptions = {
  providers: { id: string; name: string; description: string; supportsApiKey: boolean; supportsSignIn: boolean; credentialConfigured: boolean; signedIn: boolean; signupUrl?: string }[];
  localModels: { id: string; name: string; tier: string; machineLabel: string; description: string; modelCard: string; downloadBytes: number; fits: boolean; fitSummary: string; recommended: boolean; contextLength: number; modelName: string }[];
  hardware?: { ram_total_bytes?: number; uma?: boolean };
  note?: string;
};
export type HermesSignIn = {
  session_id: string; providerId: string; status?: string; user_code?: string; verification_url?: string;
};
export function HermesModelPicker({
  options, value, disabled, stopped, loading, error, models, modelsLoaded = false, recommendedModel, signIn, progress,
  onChange, onLoadOptions, onLoadModels, onConnectKey, onSignIn, onRefreshSignIn,
  onCancelSignIn, onReview, onSetupLocal, onPauseResume,
}: {
  options?: HermesModelOptions;
  value: HermesBackendSelection;
  disabled: boolean;
  stopped: boolean;
  loading: boolean;
  error?: string;
  models: string[];
  modelsLoaded?: boolean;
  recommendedModel?: string;
  signIn?: HermesSignIn;
  progress?: { phase?: string; jobId?: string; jobState?: string; completed?: number; total?: number };
  onChange: (next: Partial<HermesBackendSelection>) => void;
  onLoadOptions: () => void;
  onLoadModels: () => void;
  onConnectKey: (key: string) => Promise<void>;
  onSignIn: () => void;
  onRefreshSignIn: () => void;
  onCancelSignIn: () => void;
  onReview: () => void;
  onSetupLocal: (id: string) => void;
  onPauseResume: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  useEffect(() => { setApiKey(""); }, [value.providerId]);
  const mode = value.providerId === "llamacpp" ? "local" : !value.providerId || value.providerId === "custom" ? "existing" : "provider";
  const provider = options?.providers.find((p) => p.id === value.providerId);
  const autoLoadedProvider = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "provider" || !provider?.credentialConfigured) { autoLoadedProvider.current = null; return; }
    if (disabled || loading || autoLoadedProvider.current === provider.id) return;
    autoLoadedProvider.current = provider.id;
    onLoadModels();
  }, [mode, provider?.id, provider?.credentialConfigured, disabled, loading, onLoadModels]);
  const selectedLocal = options?.localModels.find((m) => m.id === value.localModelId);
  const bytes = (n: number) => (n / 1024 ** 3).toFixed(1) + " GB";
  function pickProvider(id: string) {
    onChange({ providerId: id, backendKind: "remote", modelName: "", localModelId: undefined, modelEndpoint: undefined, contextLength: undefined });
  }
  function pickLocal(id: string) {
    const m = options?.localModels.find((m) => m.id === id);
    if (m) onChange({ providerId: "llamacpp", backendKind: "local", localModelId: id, modelName: m.modelName, contextLength: m.contextLength, modelEndpoint: undefined });
    else onChange({ providerId: "llamacpp", backendKind: "local", localModelId: undefined, modelName: "" });
  }
  return (
    <section className="zn-model-picker" aria-label="Model backend">
      <h2>Model backend</h2>
      <div className="zn-model-picker__modes" role="group" aria-label="Model connection type">
        <button type="button" aria-pressed={mode === "provider"} disabled={disabled} onClick={() => pickProvider("anthropic")}>Cloud provider</button>
        <button type="button" aria-pressed={mode === "local"} disabled={disabled} onClick={() => pickLocal(options?.localModels.find((m) => m.recommended)?.id || options?.localModels[0]?.id || "")}>Run an open model</button>
        <button type="button" aria-pressed={mode === "existing"} disabled={disabled} onClick={() => onChange({ providerId: "custom", backendKind: "local", modelName: "", localModelId: undefined, modelEndpoint: undefined, contextLength: undefined, secretRef: undefined })}>Existing model server</button>
      </div>
      {loading && <p role="status">Checking Hermes…</p>}
      {error && <p role="alert" className="zn-setup__error">{error}</p>}
      {!options && <button type="button" disabled={disabled || loading} onClick={onLoadOptions}>Load Hermes provider and model options</button>}
      {mode === "provider" && options && (
        <>
          <label>Hermes provider
            <select value={value.providerId || ""} disabled={disabled} onChange={(e) => pickProvider(e.target.value)}>
              {options.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {provider && (
            <>
              <p>{provider.description}</p>
              <p role="status">{provider.credentialConfigured ? "Connected to " + provider.name + "." : "Connect this provider to choose a model."}</p>
              {provider.supportsSignIn && !provider.signedIn && <button type="button" disabled={disabled || loading} onClick={onSignIn}>Sign in with {provider.name}</button>}
              {provider.supportsApiKey && (
                <details open={!provider.credentialConfigured}>
                  <summary>{provider.credentialConfigured ? "Replace API key" : "Connect with an API key"}</summary>
                <form onSubmit={async (event) => {
                  event.preventDefault();
                  const key = apiKey;
                  setApiKey("");
                  await onConnectKey(key);
                }}>
                  <label>Provider API key
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} disabled={disabled || loading} />
                  </label>
                  <p className="zn-model-picker__note">Saved privately by Hermes. It is never included in the setup review or browser draft.</p>
                  <button type="submit" disabled={disabled || loading || !apiKey.trim()}>Connect provider</button>
                </form>
                </details>
              )}
              {!provider.supportsSignIn && !provider.supportsApiKey && <p>Use this provider’s native Hermes setup, then refresh its connection here.</p>}
              {!provider.credentialConfigured && provider.signupUrl && <a href={provider.signupUrl} target="_blank" rel="noreferrer">Provider setup information ↗</a>}
              {!provider.credentialConfigured && <p className="zn-model-picker__note">An API key and a consumer subscription are separate connection methods. Hermes shows the methods supported by this provider.</p>}
            </>
          )}
          {signIn && signIn.providerId === value.providerId && signIn.status !== "approved" && !provider?.signedIn && (
            <div className="zn-model-picker__signin" role="status">
              {signIn.verification_url && <a href={signIn.verification_url} target="_blank" rel="noreferrer">Open provider sign-in ↗</a>}
              {signIn.user_code && <p>Enter this code: <strong>{signIn.user_code}</strong></p>}
              <p>Sign-in status: {signIn.status || "pending"}</p>
              <button type="button" disabled={loading} onClick={onRefreshSignIn}>Check sign-in</button>
              <button type="button" disabled={loading} onClick={onCancelSignIn}>Cancel sign-in</button>
            </div>
          )}
        </>
      )}
      {mode === "local" && options && (
        <>
          {options.hardware?.ram_total_bytes && <p>This machine: {bytes(options.hardware.ram_total_bytes)} {options.hardware.uma ? "unified memory" : "system memory"}.</p>}
          <p>Choose a starting point. Hermes checks memory and download space before setup.</p>
          <div className="zn-model-picker__suggestions" role="group" aria-label="Suggested open models">
            {options.localModels.map((m) => (
              <article className={"zn-model-picker__suggestion" + (value.localModelId === m.id ? " is-selected" : "")} key={m.id}>
                <div><strong>{m.tier} · {m.name}</strong>{m.recommended && <span className="zn-setup__badge">Suggested for this machine</span>}</div>
                <p>{m.machineLabel} · {bytes(m.downloadBytes)} download</p>
                <p>{m.description}</p>
                <p className="zn-model-picker__note">Hermes estimate: {m.fitSummary}.</p>
                <button type="button" aria-pressed={value.localModelId === m.id} disabled={disabled || !m.fits} onClick={() => pickLocal(m.id)}>{value.localModelId === m.id ? "Selected" : "Choose " + m.name}</button>{" "}
                <a href={m.modelCard} target="_blank" rel="noreferrer">Model details ↗</a>
              </article>
            ))}
          </div>
          <p className="zn-model-picker__note">{options.note}</p>
          <button type="button" disabled={disabled || loading || !stopped || !selectedLocal?.fits} onClick={() => selectedLocal && onSetupLocal(selectedLocal.id)}>Review download and local setup</button>
        </>
      )}
      {mode === "existing" && (
        <>
          <p>Connect an OpenAI-compatible server you already run, such as Ollama, LM Studio or llama.cpp.</p>
          <label>Model server address
            <input value={value.modelEndpoint || ""} placeholder="http://127.0.0.1:11434" disabled={disabled} onChange={(e) => onChange({ providerId: "custom", modelEndpoint: e.target.value, secretRef: undefined, backendKind: e.target.value.startsWith("https:") ? "remote" : "local" })} />
          </label>
          <label>Server credential reference (optional)
            <input value={value.secretRef || ""} disabled={disabled} placeholder="An owner-configured secret reference" onChange={(e) => onChange({ secretRef: e.target.value || undefined })} />
          </label>
          <p className="zn-model-picker__note">Use the server origin without /v1. Authentication references resolve privately when configuration is applied.</p>
        </>
      )}
      {(mode === "existing" || mode === "provider" && provider?.credentialConfigured) && (
        <>
          <div className="zn-model-picker__model-row">
            {mode === "provider" ? (
              <>
                <label>Model for Hermes
                  <select value={value.modelName || ""} disabled={disabled || loading || !models.length} onChange={(e) => onChange({ modelName: e.target.value })}>
                    <option value="">{loading || !modelsLoaded ? "Loading available models…" : "Choose a model"}</option>
                    {value.modelName && !models.includes(value.modelName) && <option value={value.modelName}>{value.modelName} (saved selection)</option>}
                    {models.map((m) => <option key={m} value={m}>{m}{m === recommendedModel ? " · Hermes default" : ""}</option>)}
                  </select>
                </label>
                <p>This is the model Hermes will use to answer you. Your provider account may offer several models.</p>
                {value.modelName && value.modelName === recommendedModel && <p className="zn-model-picker__note">Hermes’s recommended default is selected. You can choose another model.</p>}
                {!loading && modelsLoaded && !models.length && <p role="status">Hermes could not list models for this account. Refresh the list or enter a model ID below.</p>}
                <button type="button" disabled={disabled || loading} onClick={onLoadModels}>Refresh models</button>
                <details>
                  <summary>Enter a model ID manually</summary>
                  <label>Model ID
                    <input value={value.modelName || ""} disabled={disabled} onChange={(e) => onChange({ modelName: e.target.value })} />
                  </label>
                </details>
                <p className="zn-model-picker__note">This selection takes effect after you apply the configuration and start Hermes.</p>
              </>
            ) : (
              <>
                <label>Server model
                  <input list="hermes-available-models" value={value.modelName || ""} disabled={disabled} onChange={(e) => onChange({ modelName: e.target.value })} />
                  <datalist id="hermes-available-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
                </label>
                <p className="zn-model-picker__note">The model ID served by this endpoint. Load its list or enter an ID supplied by its owner.</p>
                <button type="button" disabled={disabled || loading || !value.modelEndpoint} onClick={onLoadModels}>Load available models</button>
              </>
            )}
          </div>
          {mode === "existing" && <label>Served context window
            <input type="number" min={1024} value={value.contextLength || ""} disabled={disabled} onChange={(e) => onChange({ contextLength: e.target.value ? Number(e.target.value) : undefined })} />
          </label>}
          <button type="button" disabled={disabled || loading || !stopped || !value.modelName || (mode === "provider" && !provider?.credentialConfigured)} onClick={onReview}>Review model configuration</button>
        </>
      )}
      {!stopped && <p className="zn-model-picker__note">Stop Hermes before changing its active backend. Provider sign-in and model browsing are available now.</p>}
      {progress?.jobId && (
        <div role="status" className="zn-model-picker__progress">
          <p>Local setup: {progress.phase?.replaceAll("-", " ") || "in progress"}</p>
          {typeof progress.completed === "number" && <p>{bytes(progress.completed)}{progress.total ? " of " + bytes(progress.total) : ""}</p>}
          <button type="button" disabled={loading} onClick={onPauseResume}>{progress.jobState === "paused" ? "Resume download" : "Pause download"}</button>
        </div>
      )}
    </section>
  );
}
