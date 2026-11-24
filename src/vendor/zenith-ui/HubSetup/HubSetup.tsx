"use client";
import React, {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./HubSetup.css";
import { ZenithCloudScene } from "./ZenithCloudScene.tsx";
import { REPLY_FADE_MS, replyDisplayMs } from "./reply-timing.ts";
export type HermesEntryState =
  | "install"
  | "configure"
  | "recover"
  | "checking"
  | "unavailable";

const hermesEntryLabels: Record<HermesEntryState, string> = {
  install: "Install Hermes",
  configure: "Continue",
  recover: "Review Hermes setup",
  checking: "Checking Hermes…",
  unavailable: "Setup unavailable",
};

export function HermesSetupLanding({
  state,
  onContinue,
  onConfigure,
  configuration,
  onCloseConfiguration,
  configurationBusy = false,
  continueDisabled = false,
  continueLabel,
  primaryLabel,
  unavailableReason,
  onRetry,
  expanded,
  configurationTitle = "Configure Hermes",
  statusMessage,
  onGuideHost,
}: {
  state: HermesEntryState;
  onContinue: () => void;
  onConfigure?: () => void;
  configuration?: ReactNode;
  onCloseConfiguration?: () => void;
  configurationBusy?: boolean;
  continueDisabled?: boolean;
  continueLabel?: string;
  primaryLabel?: string;
  unavailableReason?: string;
  onRetry?: () => void;
  expanded?: boolean;
  configurationTitle?: string;
  statusMessage?: string;
  onGuideHost?: (host: HTMLDivElement | null) => void;
}) {
  const pending = state === "checking" || state === "unavailable";
  const dialog = useRef<HTMLDialogElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const guideHost = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const guideCallback = useRef(onGuideHost);
  guideCallback.current = onGuideHost;
  const titleId = useId();
  const configurationOpen = expanded ?? Boolean(configuration);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (configurationOpen && !node.open) {
      if (!returnFocus.current?.isConnected)
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      node.showModal();
      guideCallback.current?.(guideHost.current);
    } else if (!configurationOpen && node.open) {
      guideCallback.current?.(null);
      node.close();
      const target =
        returnFocus.current?.isConnected &&
        !returnFocus.current.hasAttribute("disabled")
          ? returnFocus.current
          : primaryButton.current;
      target?.focus({ preventScroll: true });
    }
  }, [configurationOpen]);
  useEffect(
    () => () => {
      guideCallback.current?.(null);
      if (dialog.current?.open) dialog.current.close();
    },
    [],
  );
  return (
    <main className="zn-hermes-landing">
      <ZenithCloudScene paused={configurationOpen} />
      <h1>Zenith Hub · Hermes</h1>
      <div className="zn-hermes-landing__action" aria-live="polite">
        <button
          ref={primaryButton}
          type="button"
          disabled={pending || continueDisabled}
          onClick={(event) => {
            returnFocus.current = event.currentTarget;
            onContinue();
          }}
        >
          {primaryLabel ||
            (state === "configure" && continueLabel
              ? continueLabel
              : hermesEntryLabels[state])}
        </button>
        {(state === "configure" || configurationOpen) && onConfigure && (
          <button
            type="button"
            className="zn-hermes-landing__configure"
            disabled={pending}
            onClick={(event) => {
              returnFocus.current = event.currentTarget;
              onConfigure();
            }}
          >
            Configure
          </button>
        )}
        {statusMessage && (
          <p className="zn-hermes-landing__status" role="status">
            {statusMessage}
          </p>
        )}
        {state === "unavailable" && (
          <div className="zn-hermes-landing__recovery" role="alert">
            <p>
              {unavailableReason ||
                "The setup controller could not be reached. Try checking again."}
            </p>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                Retry setup check
              </button>
            )}
          </div>
        )}
      </div>
      <dialog
        ref={dialog}
        className="zn-hermes-landing__configuration"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          if (!configurationBusy) onCloseConfiguration?.();
        }}
      >
        <div className="zn-hermes-landing__configuration-heading">
          <h2 id={titleId}>{configurationTitle}</h2>
          <button
            type="button"
            disabled={configurationBusy}
            aria-label="Close Hermes setup"
            onClick={onCloseConfiguration}
          >
            Close
          </button>
        </div>
        <div className="zn-setup zn-hermes-landing__configuration-body">
          {configuration}
        </div>
        <div
          ref={guideHost}
          className="zn-hermes-modal-guide-host"
          data-zenith-guide-host={onGuideHost ? "" : undefined}
        />
      </dialog>
    </main>
  );
}

export type SetupStep =
  | "welcome"
  | "communications"
  | "components"
  | "review"
  | "environment";
export const setupSteps: { id: SetupStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "communications", label: "Communications" },
  { id: "components", label: "Components" },
  { id: "review", label: "Review setup" },
  { id: "environment", label: "Your environment" },
];
export function SetupShell({
  step,
  onStep,
  children,
  busy,
  freshness,
  error,
}: {
  step: SetupStep;
  onStep: (step: SetupStep) => void;
  children: ReactNode;
  busy: boolean;
  freshness: string;
  error?: string;
}) {
  return (
    <div className="zn-setup">
      <a className="zn-setup__skip" href="#setup-main">
        Skip to setup
      </a>
      <aside>
        <a
          className="zn-setup__brand"
          href="#welcome"
          onClick={() => onStep("welcome")}
        >
          Z <span>Zenith Hub</span>
        </a>
        <nav aria-label="Setup steps">
          {setupSteps.map((s, n) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === step ? "step" : undefined}
              disabled={busy}
              onClick={() => onStep(s.id)}
            >
              <span>{n + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <p>
          Your services. Your data.
          <br />
          Choose what belongs here.
        </p>
      </aside>
      <main id="setup-main">
        <header>
          <span>YOUR LOCAL HUB</span>
          <span role="status">{freshness}</span>
        </header>
        {error && (
          <div role="alert" className="zn-setup__error">
            {error}
          </div>
        )}
        {children}
        <footer>
          Deployment actions always require a reviewed plan. Chat advice does
          not apply changes.
        </footer>
      </main>
    </div>
  );
}
export function SetupIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="zn-setup__intro">
      {eyebrow && <span className="zn-setup__eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {children}
    </div>
  );
}
export function SetupPanel({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="zn-setup__panel">
      <div className="zn-setup__heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function ComponentChoice({
  name,
  description,
  selected,
  onSelect,
  children,
}: {
  name: string;
  description: string;
  selected: boolean;
  onSelect: (value: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <section className={"zn-setup__choice" + (selected ? " is-selected" : "")}>
      <label className="zn-setup__choice-label">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
        <span>
          <strong>{name}</strong>
          <small>{description}</small>
        </span>
        <span className="zn-setup__badge">
          {selected ? "Selected" : "Available"}
        </span>
      </label>
      {selected && <div className="zn-setup__choice-content">{children}</div>}
    </section>
  );
}
export type ConnectionListItem = {
  id: string;
  name: string;
  endpoint: string;
  status: string;
  detail?: string;
  action?: "choose" | "manage";
};
export function ConnectionList({
  items,
  disabled,
  onChoose,
  onManage,
}: {
  items: ConnectionListItem[];
  disabled: boolean;
  onChoose: (item: ConnectionListItem) => void;
  onManage: (item: ConnectionListItem) => void;
}) {
  return (
    <ul className="zn-setup__connections" aria-label="Service connections">
      {items.map((item) => (
        <li key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <span className="zn-setup__connection-endpoint">
              {item.endpoint}
            </span>
            {item.detail && <small>{item.detail}</small>}
          </div>
          <span className="zn-setup__badge">{item.status}</span>
          {item.action === "choose" && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChoose(item)}
            >
              Choose this connection
            </button>
          )}
          {item.action === "manage" && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onManage(item)}
            >
              Manage connection
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
export function StateFacts({
  facts,
}: {
  facts: { label: string; value: string }[];
}) {
  return (
    <dl className="zn-setup__facts">
      {facts.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function SourceDetails({
  repository,
  revision,
  schema,
  children,
}: {
  repository: string;
  revision: string;
  schema?: unknown;
  children?: ReactNode;
}) {
  return (
    <details className="zn-setup__details">
      <summary>Source, schema and dependencies</summary>
      <p>
        <a
          href={"https://github.com/" + repository}
          target="_blank"
          rel="noreferrer"
        >
          {repository}
        </a>
        <br />
        <code>{revision}</code>
      </p>
      {children}
      {schema !== undefined && (
        <details>
          <summary>Configuration schema</summary>
          <pre>{JSON.stringify(schema, null, 2)}</pre>
        </details>
      )}
    </details>
  );
}
export function HermesChatHud({
  children,
  connected,
  openSignal = 0,
  onSend,
  busy = false,
  status = "",
}: {
  children?: ReactNode;
  connected: boolean;
  openSignal?: number;
  onSend?: (message: string) => Promise<string>;
  busy?: boolean;
  status?: string;
}) {
  if (onSend)
    return (
      <HermesMessagePill
        available={connected}
        busy={busy}
        status={status}
        onSend={onSend}
        openSignal={openSignal}
      />
    );
  return (
    <LegacyHermesChatHud connected={connected} openSignal={openSignal}>
      {children}
    </LegacyHermesChatHud>
  );
}
function LegacyHermesChatHud({
  children,
  connected,
  openSignal = 0,
}: {
  children: ReactNode;
  connected: boolean;
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const hasOpened = useRef(false);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  useEffect(() => {
    if (open) {
      hasOpened.current = true;
      const input = panel.current?.querySelector<HTMLTextAreaElement>(
        "textarea:not(:disabled)",
      );
      (input || panel.current)?.focus();
    } else if (hasOpened.current) launcher.current?.focus();
  }, [open]);
  return (
    <div className="zn-setup zn-hermes-hud">
      <button
        ref={launcher}
        type="button"
        className="zn-hermes-hud__launcher"
        hidden={open}
        aria-label="Open Hermes chat"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span
          aria-hidden="true"
          className={"zn-hermes-hud__dot" + (connected ? " is-connected" : "")}
        />
        <strong>Hermes</strong>
        <span>{connected ? "Chat" : "Setup help"}</span>
      </button>
      <section
        ref={panel}
        hidden={!open}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label="Hermes chat"
        className="zn-hermes-hud__panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <div className="zn-hermes-hud__header">
          <h2>Hermes</h2>
          <button
            type="button"
            aria-label="Minimize Hermes chat"
            onClick={() => setOpen(false)}
          >
            Minimize
          </button>
        </div>
        <div className="zn-hermes-hud__body">{children}</div>
      </section>
    </div>
  );
}
function HermesMessagePill({
  available,
  busy,
  status,
  onSend,
  openSignal,
}: {
  available: boolean;
  busy: boolean;
  status: string;
  onSend: (message: string) => Promise<string>;
  openSignal: number;
}) {
  const [message, setMessage] = useState(""),
    [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(true),
    [sending, setSending] = useState(false),
    [fading, setFading] = useState(false),
    [pageVisible, setPageVisible] = useState(true),
    [latestReply, setLatestReply] = useState<{ id: number; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    orb = useRef<HTMLButtonElement>(null),
    interacted = useRef(false),
    mounted = useRef(true),
    pending = useRef(false),
    sequence = useRef(0),
    replyClock = useRef<{ id: number; remaining: number } | null>(null);
  const responseId = useId();
  useEffect(() => {
    mounted.current = true;
    const visibility = () => setPageVisible(!document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (interacted.current) (collapsed ? orb.current : input.current)?.focus();
  }, [collapsed]);
  useEffect(() => {
    const notify = () => document.dispatchEvent(new Event("zenith:hermes-guide-activity"));
    notify();
    return () => { notify(); };
  }, [collapsed, open, sending]);
  useEffect(() => {
    if (openSignal > 0) {
      interacted.current = true;
      setCollapsed(false);
      if (latestReply) {
        replyClock.current = { id: latestReply.id, remaining: replyDisplayMs(latestReply.text) };
        setFading(false);
        setOpen(true);
      }
      input.current?.focus();
    }
  }, [openSignal]);

  // Only visible reading time counts. Cleanup retains the remaining duration.
  // Each timer owns a clock object so a replaced reply cannot be hidden by it.
  useEffect(() => {
    const clock = replyClock.current;
    if (!latestReply || !clock || clock.id !== latestReply.id ||
        !open || collapsed || !pageVisible) return;
    const startedAt = performance.now();
    let didFade = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const fadeTimer = setTimeout(() => {
      if (replyClock.current !== clock) return;
      didFade = true;
      clock.remaining = 0;
      setFading(true);
      hideTimer = setTimeout(() => {
        if (replyClock.current !== clock) return;
        setOpen(false);
        setFading(false);
      }, REPLY_FADE_MS);
    }, clock.remaining);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      if (!didFade)
        clock.remaining = Math.max(0, clock.remaining - (performance.now() - startedAt));
    };
  }, [latestReply, open, collapsed, pageVisible, openSignal]);

  function publishReply(text: string) {
    const reply = { id: ++sequence.current, text: text.trim() };
    replyClock.current = { id: reply.id, remaining: replyDisplayMs(reply.text) };
    setLatestReply(reply.text ? reply : null);
    setFading(false);
    setOpen(Boolean(reply.text));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || !available || busy || pending.current) return;
    pending.current = true;
    replyClock.current = null;
    setLatestReply(null);
    setFading(false);
    setMessage("");
    setOpen(false);
    setSending(true);
    try {
      const reply = await onSend(text);
      if (mounted.current) publishReply(reply);
    } catch {
      if (mounted.current) {
        publishReply("Hermes could not reply. Check the connection and try again.");
        setMessage((current) => current || text);
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setSending(false);
        input.current?.focus();
      }
    }
  }
  function dismissReply() {
    setOpen(false);
    setFading(false);
    input.current?.focus();
  }
  function collapse() {
    interacted.current = true;
    setCollapsed(true);
  }
  function expand() {
    interacted.current = true;
    setCollapsed(false);
  }
  function toggleReply() {
    if (open) dismissReply();
    else if (latestReply) {
      replyClock.current = { id: latestReply.id, remaining: replyDisplayMs(latestReply.text) };
      setFading(false);
      setOpen(true);
    }
    input.current?.focus();
  }
  return (
    <div
      className={
        "zn-setup zn-hermes-hud zn-hermes-hud--composer" +
        (collapsed ? " is-collapsed" : "") +
        (sending ? " is-loading" : "")
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && !collapsed) {
          event.preventDefault();
          if (open) dismissReply();
          else collapse();
        }
      }}
    >
      {collapsed && (
        <button
          ref={orb}
          type="button"
          className="zn-hermes-hud__orb"
          aria-label="Open Hermes message input"
          aria-expanded={false}
          aria-busy={sending}
          aria-controls={responseId + "-composer"}
          title="Message Hermes"
          onClick={expand}
        >
          {sending && <HermesLoadingBorder />}
          <span
            aria-hidden="true"
            className={"zn-hermes-hud__dot" + (available ? " is-connected" : "")}
          />
        </button>
      )}
      <section
        id={responseId}
        hidden={collapsed || !open || !latestReply}
        role="region"
        aria-label="Latest Hermes response"
        className={"zn-hermes-hud__panel" + (fading ? " is-fading" : "")}
      >
        <p className="zn-hermes-hud__reply" role="status" aria-live="polite" aria-atomic="true">
          {latestReply?.text}
        </p>
      </section>
      <form
        id={responseId + "-composer"}
        hidden={collapsed}
        className="zn-hermes-hud__composer"
        onSubmit={submit}
        aria-label="Message Hermes"
        aria-busy={sending}
        aria-describedby={responseId + "-connection"}
      >
        {sending && <HermesLoadingBorder />}
        <span id={responseId + "-connection"} className="zn-hermes-hud__sr-only" role="status">
          {sending ? "Hermes is replying." : status}
        </span>
        <button
          type="button"
          className="zn-hermes-hud__dot-control"
          aria-label="Minimize Hermes input"
          aria-expanded={true}
          aria-controls={responseId + "-composer"}
          title="Minimize Hermes"
          onClick={collapse}
        >
          <span
            aria-hidden="true"
            className={"zn-hermes-hud__dot" + (available ? " is-connected" : "")}
          />
        </button>
        <input
          ref={input}
          type="text"
          aria-label="Message Hermes"
          placeholder="Ask Hermes…"
          maxLength={4000}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing)
              event.preventDefault();
          }}
          autoComplete="off"
        />
        <button
          type="button"
          className="zn-hermes-hud__history"
          aria-label={open ? "Hide latest Hermes response" : "Show latest Hermes response"}
          aria-expanded={open}
          aria-controls={responseId}
          disabled={!latestReply}
          onClick={toggleReply}
        >
          ⌃
        </button>
        <button
          type="submit"
          className="zn-hermes-hud__send"
          aria-label="Send message to Hermes"
          disabled={!available || busy || sending || !message.trim()}
        >
          ↑
        </button>
      </form>
    </div>
  );
}
function HermesLoadingBorder() {
  return (
    <svg className="zn-hermes-hud__loading-border" aria-hidden="true" focusable="false">
      <rect className="zn-hermes-hud__loading-track" x="1" y="1" rx="26" pathLength="100" />
      <rect className="zn-hermes-hud__loading-arc" x="1" y="1" rx="26" pathLength="100" />
    </svg>
  );
}
export function GuideChat({
  available,
  busy,
  onSend,
  status,
  promptLabel = "Your setup question",
}: {
  available: boolean;
  busy: boolean;
  onSend: (text: string) => Promise<string>;
  status: string;
  promptLabel?: string;
}) {
  const [message, setMessage] = useState(""),
    [turns, setTurns] = useState<{ role: string; text: string }[]>([]),
    [sending, setSending] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setMessage("");
    setTurns((t) => [...t, { role: "You", text }]);
    setSending(true);
    try {
      const reply = await onSend(text);
      setTurns((t) => [...t, { role: "Hermes", text: reply }]);
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: "Connection",
          text: "Hermes could not answer. Check its model backend and connection; no deployment action was applied.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }
  return (
    <SetupPanel title="Ask Hermes">
      <p>{status}</p>
      <div className="zn-setup__conversation" role="log" aria-live="polite">
        {turns.map((t, n) => (
          <div key={n}>
            <strong>{t.role}</strong>
            <p>{t.text}</p>
          </div>
        ))}
      </div>
      <form onSubmit={submit}>
        <label>
          {promptLabel}
          <textarea
            rows={2}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={!available || busy || sending}
          />
        </label>
        <button
          className="zn-setup__primary"
          disabled={!available || !message.trim() || busy || sending}
        >
          {sending ? "Waiting for Hermes…" : "Ask Hermes"}
        </button>
      </form>
      <details>
        <summary>Setup help available offline</summary>
        <p>
          Connect a local Hermes API to use agent chat. The agent process and
          its model backend are separate: a local process may use a remote
          model. Matrix is optional and can be configured later.
        </p>
        <p>
          Install adds software. Configure creates its local settings. Start
          launches the selected service. Connecting an existing service grants
          no process control.
        </p>
      </details>
    </SetupPanel>
  );
}
export function PlanReview({
  title,
  children,
  onApply,
  onCancel,
  busy,
  blocked,
}: {
  title: string;
  children: ReactNode;
  onApply: () => void;
  onCancel: () => void;
  busy: boolean;
  blocked: boolean;
}) {
  return (
    <SetupPanel title={title}>
      <div className="zn-setup__review">{children}</div>
      <div className="zn-setup__actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel review
        </button>
        <button
          className="zn-setup__primary"
          type="button"
          disabled={busy || blocked}
          onClick={onApply}
        >
          {busy ? "Applying…" : "Apply reviewed plan"}
        </button>
      </div>
      {blocked && (
        <p>Complete the listed prerequisites, then create a new review.</p>
      )}
    </SetupPanel>
  );
}
