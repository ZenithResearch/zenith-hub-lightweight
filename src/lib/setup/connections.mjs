/** Communications display is based on registered resources, not reachability alone. */
const communications = new Set(["matrix", "hermes"]);
function origin(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" ? u.origin : null;
  } catch { return null; }
}
export function serviceEndpoint(item) {
  if (item.mode === "install") return Number.isInteger(item.config?.port) ? origin("http://127.0.0.1:" + item.config.port) : null;
  return origin(item.config?.endpoint);
}
const key = (componentId, endpoint) => componentId + ":" + endpoint;
export function communicationRows(instances, candidates, selection, { stale = false, now = Date.now(), labels = {} } = {}) {
  const rows = new Map();
  for (const instance of instances) {
    const endpoint = serviceEndpoint(instance);
    if (!communications.has(instance.componentId) || !endpoint) continue;
    const id = key(instance.componentId, endpoint);
    const previous = rows.get(id);
    if (!previous || previous.instance.partial && !instance.partial) rows.set(id, { componentId: instance.componentId, endpoint, instance });
  }
  for (const candidate of candidates || []) {
    const endpoint = origin(candidate.endpoint);
    if (communications.has(candidate.componentId) && endpoint && !rows.has(key(candidate.componentId, endpoint))) rows.set(key(candidate.componentId, endpoint), { ...candidate, endpoint });
  }
  return [...rows.entries()].map(([id, row]) => {
    const instance = row.instance;
    const observation = instance?.observation || row.observation;
    const age = now - Date.parse(observation?.observedAt);
    const fresh = !stale && instance?.stale !== true && Number.isFinite(age) && age >= -5000 && age <= 30000;
    let status, detail, action;
    if (instance) {
      action = "manage";
      if (instance.partial || instance.mode !== "connect" && instance.installed !== true) status = "Setup incomplete";
      else if (!fresh) status = "Connection saved · checking";
      else if (instance.mode === "install" && instance.running === false) status = "Stopped";
      else if (observation?.reachable === true) status = ["credential-required", "authentication_failed", "access_denied"].includes(observation.permission) ? "Credentials required" : "Connected";
      else status = "Connection saved · unavailable";
    } else {
      const selected = selection.some((item) => item.componentId === row.componentId && item.mode === "connect" && serviceEndpoint(item) === row.endpoint);
      if (selected) {
        status = "Selected";
        detail = fresh && observation?.reachable ? "Review to connect." : "Review pending · connection needs checking.";
      } else if (!fresh) status = "Status needs refresh";
      else if (observation?.reachable) { status = "Available"; action = "choose"; }
      else status = "Unavailable";
    }
    return { id, componentId: row.componentId, instanceId: instance?.instanceId, endpoint: row.endpoint,
      name: labels[row.componentId] || row.componentId, status, detail, action };
  });
}
