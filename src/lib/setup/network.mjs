/** Bounded, redirect-free resource requests. Remote DNS is resolved and pinned per request. */
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { check } from "./catalog.mjs";
export function endpoint(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    check(null, false, "invalid_endpoint");
  }
  check(
    u,
    typeof value === "string" &&
      value.trim() === value && /^https?:\/\//i.test(value) && !value.includes(String.fromCharCode(92)) &&
      u.pathname === "/" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash,
    "invalid_endpoint",
  );
  check(
    u,
    (u.protocol === "http:" && u.hostname === "127.0.0.1" && !!u.port) ||
      u.protocol === "https:",
    "unsafe_endpoint",
  );
  return u;
}
export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a < 224 &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && b === 168) &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(ip) === 6 &&
    /^2[0-9a-f]{3}:/i.test(ip) &&
    !/^2001:(?:db8|0:)/i.test(ip)
  );
}
export async function requestJSON(
  base,
  route,
  {
    method = "GET",
    body,
    token,
    timeout = 5000,
    allowPrivateHosts = [],
    resolve = lookup,
  } = {},
) {
  const u = endpoint(base);
  check(route, /^\/[A-Za-z0-9_./?=&%-]*$/.test(route), "invalid_probe_path");
  const local = u.hostname === "127.0.0.1" && u.protocol === "http:";
  const addresses = local
    ? [{ address: "127.0.0.1", family: 4 }]
    : await resolve(u.hostname, { all: true, verbatim: true });
  check(
    addresses,
    addresses.length > 0 &&
      (local ||
        addresses.every(
          (a) =>
            publicAddress(a.address) || allowPrivateHosts.includes(u.hostname),
        )),
    "private_remote_endpoint",
  );
  const address = addresses[0],
    bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "http:" ? http : https).request(
      u.origin + route,
      {
        method,
        lookup: (_h, _o, cb) => cb(null, address.address, address.family),
        headers: {
          Accept: "application/json",
          ...(bytes
            ? {
                "Content-Type": "application/json",
                "Content-Length": bytes.length,
              }
            : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (b) => {
          size += b.length;
          if (size > 1048576) req.destroy(Error("response_too_large"));
          else chunks.push(b);
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks));
            resolve({ status: res.statusCode, value });
          } catch {
            reject(Error("incompatible_contract"));
          }
        });
      },
    );
    req.setTimeout(timeout, () => req.destroy(Error("probe_timeout")));
    req.on("error", reject);
    if (bytes) req.write(bytes);
    req.end();
  });
}
export async function probe(componentId, base, options = {}) {
  const observedAt = new Date().toISOString(),
    result = {
      observedAt,
      reachable: false,
      applicationReady: false,
      permission: "not-tested",
      contract: "not-tested",
      error: null,
    };
  const probes = {
    matrix: async () => {
      const a = await requestJSON(base, "/_matrix/client/versions", options);
      check(
        a,
        a.status === 200 &&
          Array.isArray(a.value.versions) &&
          a.value.versions.some(
            (v) => /^v\d+\.\d+$/.test(v) || /^r0\./.test(v),
          ),
        "incompatible_matrix_versions",
      );
      const login = await requestJSON(
        base,
        "/_matrix/client/v3/login",
        options,
      );
      check(
        login,
        (login.status === 200 && Array.isArray(login.value.flows)) || [404,405].includes(login.status),
        "matrix_login_unavailable",
      );
      if (options.token) {
        const who = await requestJSON(base, "/_matrix/client/v3/account/whoami", options);
        if (who.status === 401) return {apiAvailable:true, applicationReady:false, permission:"session-expired", contract:"matrix-client-api"};
        if (who.status === 403) return {apiAvailable:true, applicationReady:false, permission:"access_denied", contract:"matrix-client-api"};
        check(who, who.status === 200 && typeof who.value.user_id === "string", "matrix_identity_unverified");
        return {apiAvailable:true, applicationReady:true, permission:"authenticated", userId:who.value.user_id, deviceId:who.value.device_id, contract:"matrix-client-api", matrixVersions:a.value.versions, loginFlows:login.value.flows||[]};
      }
      return {
        matrixVersions: a.value.versions,
        applicationReady: false,
        apiAvailable: true,
        loginFlows: login.value.flows || [],
        contract: "matrix-client-api",
        permission: "login-required",
      };
    },
    hermes: async () => {
      const a = await requestJSON(base, "/health", options);
      check(
        a,
        a.status === 200 &&
          a.value.platform === "hermes-agent" &&
          a.value.status === "ok",
        "incompatible_hermes",
      );
      const c = await requestJSON(base, "/v1/capabilities", options);
      if (c.status === 401 || c.status === 403)
        return { applicationReady: false, permission: "credential-required" };
      check(
        c,
        c.status === 200 && c.value.object === "hermes.api_server.capabilities",
        "incompatible_hermes",
      );
      return {
        applicationReady: false,
        contract: "hermes-chat-api",
        permission: options.token ? "configured" : "not-required",
        model: c.value.model,
        chatAvailable: true,
      };
    },
    "service-management": async () => {
      const a = await requestJSON(base, "/live", options);
      const b = await requestJSON(base, "/ready", options);
      check(a, a.status === 200, "service_unreachable");
      return {
        applicationReady: b.status === 200 && b.value.ready === true,
        contract: "liveness-only",
      };
    },
    "process-runtime": async () => {
      const a = await requestJSON(base, "/live", options);
      const b = await requestJSON(base, "/ready", options);
      check(a, a.status === 200, "runtime_unreachable");
      return {
        applicationReady: b.status === 200 && b.value.ready === true,
        contract: "liveness-only",
      };
    },
    devgraph: async () => {
      const a = await requestJSON(base, "/ready", options);
      check(
        a,
        a.status === 200 && a.value.ready === true,
        "devgraph_not_ready",
      );
      if (!options.token)
        return { applicationReady: false, permission: "credential-required" };
      const b = await requestJSON(base, "/work/Task?limit=1", options);
      check(
        b,
        b.status === 200 && Array.isArray(b.value.items),
        "devgraph_read_denied",
      );
      return {
        applicationReady: true,
        contract: "devgraph-work-reader",
        permission: "read-verified",
      };
    },
  };
  try {
    check(null, !!probes[componentId], "probe_unsupported");
    return { ...result, reachable: true, ...(await probes[componentId]()) };
  } catch (e) {
    return {
      ...result,
      error: [
        "credential-required",
        "private_remote_endpoint",
        "unsafe_endpoint",
      ].includes(e.code)
        ? e.code
        : "unavailable-or-incompatible",
    };
  }
}
