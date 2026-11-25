/** Resolve the configured Hermes receiver. The persistent HUD shell and Matrix view are independent. */
const eligible = i => i.componentId === "hermes" && typeof i.instanceId === "string" && i.enabled !== false && !i.partial && (i.mode === "connect" || i.installed === true && i.configured === true && i.backendConfigured !== false);
/** Existing configured receivers only: this view never creates a Hermes profile. */
export function hermesQuickTargets(snapshot) {
  if(snapshot?.mode !== "local") return [];
  const instances=(snapshot.instances||[]).filter(eligible),seen=new Set();
  const palette=["#75dfc2","#ffcc80","#bca4ff","#88d9ff","#ff9eac","#d4e58a"];
  return instances.filter(i=>!seen.has(i.instanceId)&&seen.add(i.instanceId)).map((i,index)=>({
    id:i.instanceId,
    label:typeof i.config?.label === "string" && i.config.label.trim()?i.config.label.trim().slice(0,100):typeof i.config?.profileName === "string" && i.config.profileName.trim()?"Hermes · "+i.config.profileName.trim().slice(0,80):instances.length===1?"Hermes":"Hermes · "+i.instanceId,
    color:palette[index%palette.length]
  }));
}
export function hermesChatState(snapshot, receivedAt, now = Date.now(), preferredInstanceId) {
  const targetId=preferredInstanceId??snapshot?.welcomeTargetId;
  const instance = snapshot?.instances?.find(i=>eligible(i)&&(!targetId||i.instanceId===targetId));
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
