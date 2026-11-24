/** UI projection of durable setup facts. No browser-only completion flags. */
export function welcomeState(snapshot, targetId) {
  const instances = (snapshot?.instances || []).filter(
    (i) => i.componentId === "hermes",
  );
  const instance = targetId
    ? instances.find((i) => i.instanceId === targetId)
    : instances.length === 1
      ? instances[0]
      : undefined;
  if (!snapshot) return { phase: "checking", instances };
  if (instances.length > 1 && !instance)
    return { phase: "choose-instance", instances };
  const operation =
    instance &&
    [...(snapshot.operations || [])]
      .reverse()
      .find((o) => o.instanceIds?.includes(instance.instanceId));
  if (operation?.state === "applying")
    return {
      phase: operation.outcomeUnknown ? "reconcile" : "working",
      instance,
      operation,
      instances,
    };
  if (operation?.state === "reconciliation-required")
    return { phase: "reconcile", instance, operation, instances };
  if (!instance)
    return {
      phase: snapshot.hermesInstallations?.length ? "installation" : "install",
      instances,
    };
  if (instance.partial || instance.installed === false)
    return { phase: "resume", instance, instances };
  const completed = instance.setupCompletion?.valid === true;
  if (completed) return { phase: "ready", instance, instances };
  if (instance.mode === "connect")
    return { phase: "ready", instance, instances };
  if (!instance.backendConfigured || !instance.config?.modelName)
    return { phase: "model", instance, instances };
  if (
    instance.running === true &&
    instance.observation?.reachable &&
    instance.observation?.chatAvailable
  )
    return { phase: "ready", instance, instances };
  return {
    phase: instance.running === true ? "connecting" : "start",
    instance,
    instances,
  };
}

/** Landing disclosure stays independent of installation and configuration facts. */
export function welcomeLandingState(snapshot, state = welcomeState(snapshot)) {
  const installed =
    !!snapshot &&
    (snapshot.hermesInstallations?.length > 0 ||
      state.instances.some(
        (i) => i.mode === "connect" || (i.installed === true && !i.partial),
      ));
  if (!snapshot || state.phase === "checking")
    return {
      state: "checking",
      label: "Checking Hermes…",
      installed: false,
      status: "",
    };
  if (["working", "reconcile", "resume"].includes(state.phase))
    return {
      state: "recover",
      installed,
      label:
        state.phase === "working"
          ? "View progress"
          : state.phase === "resume"
            ? "Resume installation"
            : "Review retained progress",
      status:
        state.phase === "working"
          ? "Setup is running. You can close its view and return to the retained progress."
          : "Your retained setup needs review before continuing.",
    };
  return {
    state: installed ? "configure" : "install",
    label: installed ? "Continue" : "Install Hermes",
    installed,
    status: "",
  };
}
