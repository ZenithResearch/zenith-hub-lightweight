"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appendPageContext } from "@/lib/setup/chat-message.mjs";
import { capturePageContext } from "@/lib/setup/page-context";
import { HermesChatHud } from "@/vendor/zenith-ui/HubSetup/HubSetup";
import {
  hermesChatState,
  type HermesChatSnapshot,
} from "@/lib/setup/hermes-chat-state.mjs";
import { GlobalMatrixChat } from "./GlobalMatrixChat";
const snapshotEvent = "zenith:hub-setup-snapshot";
const refreshEvent = "zenith:hub-setup-refresh";
export function GlobalHermesChat() {
  const [snapshot, setSnapshot] = useState<HermesChatSnapshot | null>(null);
  const [openSignal, setOpenSignal] = useState(0);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const pending = useRef<Promise<HermesChatSnapshot | null> | null>(null);
  function receive(value: HermesChatSnapshot) {
    if (!mounted.current) return;
    setSnapshot(value);
    setReceivedAt(Date.now());
  }
  function refresh(): Promise<HermesChatSnapshot | null> {
    if (pending.current) return pending.current;
    const abort = new AbortController();
    inFlight.current = abort;
    const timeout = setTimeout(() => abort.abort(), 8000);
    const task = (async () => {
      try {
        const response = await fetch("/api/setup", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) throw Error("connection_unavailable");
        const value = await response.json();
        if (inFlight.current === abort) receive(value);
        return value as HermesChatSnapshot;
      } catch {
        if (mounted.current && inFlight.current === abort) setReceivedAt(0);
        return null;
      } finally {
        clearTimeout(timeout);
        if (inFlight.current === abort) {
          inFlight.current = null;
          pending.current = null;
        }
      }
    })();
    pending.current = task;
    return task;
  }
  useEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-zenith-hermes-portal", "");
    function move(event?: Event) {
      const target = event
        ? (event as CustomEvent<{ host: HTMLDivElement | null }>).detail?.host
        : document.querySelector<HTMLDivElement>(
            "dialog[open] [data-zenith-guide-host]",
          );
      if (
        target instanceof HTMLElement &&
        target.isConnected &&
        target.closest("dialog[open]")
      )
        target.appendChild(host);
      else document.body.appendChild(host);
    }
    move();
    setPortalHost(host);
    window.addEventListener("zenith:hermes-guide-host", move);
    return () => {
      window.removeEventListener("zenith:hermes-guide-host", move);
      host.remove();
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = setInterval(() => void refresh(), 15000);
    const tick = setInterval(() => setNow(Date.now()), 2000);
    const focus = () => void refresh();
    const receiveEvent = (event: Event) => {
      const value = (event as CustomEvent<HermesChatSnapshot>).detail;
      if (value?.root && Array.isArray(value.instances) && value.csrf)
        receive(value);
    };
    const openChat = () => {
      setOpenSignal((n) => n + 1);
      void refresh();
    };
    window.addEventListener("zenith:hermes-chat-open", openChat);
    window.addEventListener("focus", focus);
    window.addEventListener(snapshotEvent, receiveEvent);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(tick);
      const cancelled = inFlight.current;
      inFlight.current = null;
      pending.current = null;
      cancelled?.abort();
      window.removeEventListener("zenith:hermes-chat-open", openChat);
      window.removeEventListener("focus", focus);
      window.removeEventListener(snapshotEvent, receiveEvent);
    };
  }, []);
  const state = hermesChatState(snapshot, receivedAt, now);
  async function sendMessage(message: string) {
    // MVP ONLY: Appending page content is a temporary context bridge.
    // TODO: Improve context injection for agents and generalize inputs around the
    // eventual secS message contract for both agent and non-agent receivers.
    // Keep domain input, attached context and Hermes/provider bindings distinct.
    const contextualMessage = appendPageContext(message, capturePageContext());
    const fresh = await refresh();
    const target = hermesChatState(fresh, Date.now());
    if (!fresh?.csrf || !target.available || target.identity !== state.identity)
      throw Error("hermes_unavailable");
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zenith-CSRF": fresh.csrf,
      },
      body: JSON.stringify({
        schema: "zenith.hub-setup-action.v1",
        operation: "chat",
        instanceId: target.instance?.instanceId,
        message: contextualMessage,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const reply = await response.json();
    if (!response.ok || typeof reply.message !== "string")
      throw Error("hermes_unavailable");
    receive(reply);
    window.dispatchEvent(new Event(refreshEvent));
    return reply.message;
  }
  function closeMatrix(){
    setMatrixOpen(false);
    requestAnimationFrame(()=>portalHost?.querySelector<HTMLButtonElement>(".zn-hermes-hud__orb")?.focus());
  }
  if (!portalHost) return null;
  const hudStatus=state.status || (snapshot ? "Configure Hermes to use its input. Matrix is available from the dial." : "Checking the Hermes connection.");
  return createPortal(
    <>
    <HermesChatHud
      key={state.identity || "hub-hud"}
      connected={state.available}
      openSignal={openSignal}
      busy={snapshot?.busy === true}
      status={hudStatus}
      matrixOpen={matrixOpen}
      onOpenMatrix={()=>setMatrixOpen(true)}
      onCloseMatrix={closeMatrix}
      onSend={sendMessage}
    />
    <GlobalMatrixChat open={matrixOpen} onClose={closeMatrix}/>
    </>,
    portalHost,
  );
}
