/** Resolve the configured Hermes receiver. The persistent HUD shell and Matrix view are independent. */
export function hermesChatState(snapshot, receivedAt, now = Date.now()) {
  const instance = snapshot?.instances?.find((i) => (!snapshot.welcomeTargetId || i.instanceId === snapshot.welcomeTargetId) && i.componentId === "hermes" && !i.partial && (i.mode === "connect" || i.installed === true && i.configured === true && i.backendConfigured !== false));
  if (!instance || snapshot.mode !== "local") return { visible: false, available: false, status: "" };
  const fresh = receivedAt > 0 && now - receivedAt <= 30000 && instance.stale !== true;
  const model = instance.mode === "connect" || typeof instance.config?.modelName === "string" && !!instance.config.modelName.trim();
  const available = fresh && model && instance.observation?.reachable === true && instance.observation?.chatAvailable === true && (instance.mode === "connect" || instance.running !== false) && !snapshot.busy;
  const status = !fresh ? "Checking the Hermes connection. Your conversation stays here."
    : snapshot.busy ? "Setup is running. You can chat when it finishes."
    : instance.running === false && instance.mode !== "connect" ? "Hermes is stopped. Start it in setup to chat."
    : !model ? "Choose a model in Hermes setup to enable chat."
    : available ? "Connected to Hermes. Replies use your configured model."
    : "Hermes is unavailable. Check its connection and model in setup.";
  return { visible: true, available, status, instance, identity: snapshot.root + "/" + instance.instanceId };
}
