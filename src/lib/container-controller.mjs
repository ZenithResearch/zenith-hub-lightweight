/** Fixed, read-only development-container status. No Docker socket or host commands. */
import { randomBytes } from "node:crypto";
import { OperatorError } from "./pilot-controller.mjs";
export function createContainerController({ env = process.env, fetcher = fetch } = {}) {
  const native = env.ZENITH_NATIVE_DEMO === "1";
  const enabled = env.ZENITH_CONTAINER_DEMO === "1" || native;
  const origin = env.ZENITH_OPERATOR_ORIGIN || "http://127.0.0.1:4218";
  const expected = new URL(origin);
  if (expected.origin !== origin || expected.protocol !== "http:" || expected.hostname !== "127.0.0.1" || expected.port !== "4218")
    throw new OperatorError("invalid_container_origin");
  const csrf = randomBytes(24).toString("hex");
  function admit(request) {
    if (!enabled) throw new OperatorError("container_demo_disabled", 403);
    const supplied = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
    if (request.headers.get("host") !== expected.host || new URL(request.url).origin !== origin ||
        (supplied && supplied !== origin) || (site && !["same-origin", "none"].includes(site)))
      throw new OperatorError("wrong_origin", 403);
  }
  async function health(name, port) {
    try {
      const response = await fetcher(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(2000), redirect: "error", cache: "no-store" });
      const value = await response.json();
      return { name, live: true, ready: response.ok && value.ready === true, managed: true };
    } catch { return { name, live: false, ready: false, managed: true }; }
  }
  return {
    enabled,
    async get(request) {
      admit(request);
      return { schema: "zenith.deployer.v1", mode: "local", profile: native ? "process-native-demo-v1" : "process-docker-demo-v1", target: native ? "Native · isolated demo data" : "Docker · isolated demo volume", csrf, busy: false,
        actions: [], release_digest: null,
        status: { installed: true, authority: "pending", pilot_ready: false, external_effects: false, actor_count: 0,
          components: await Promise.all([health("service",native ? 18091 : 8091), health("runtime",native ? 18092 : 8092)]) } };
    },
    admitMutation() { throw new OperatorError("compose_managed_read_only", 403); },
    async post() { throw new OperatorError("compose_managed_read_only", 403); },
  };
}
