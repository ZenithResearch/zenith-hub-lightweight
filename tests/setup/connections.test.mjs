import test from "node:test";
import assert from "node:assert/strict";
import { communicationRows, serviceEndpoint } from "../../src/lib/setup/connections.mjs";
const now = Date.parse("2026-11-20T20:00:00Z");
const observation = { observedAt: new Date(now).toISOString(), reachable: true };
const saved = { instanceId: "matrix-existing", componentId: "matrix", mode: "connect", config: { endpoint: "http://127.0.0.1:8008" }, observation };
const candidate = { componentId: "matrix", endpoint: "http://127.0.0.1:8008/", observation };
test("registered endpoints are connected rows without duplicate connect actions", () => {
  const rows = communicationRows([saved], [candidate], [], { now });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "API available · sign in required");
  assert.equal(rows[0].action, "manage");
  const local = { ...saved, mode: "install", installed: true, running: true, config: { port: 19408 } };
  assert.equal(serviceEndpoint(local), "http://127.0.0.1:19408");
  assert.equal(communicationRows([local], [], [], { now })[0].status, "API available · sign in required");
});
test("reachability is an available service, and a draft choice is selected rather than connected", () => {
  assert.equal(communicationRows([], [candidate], [], { now })[0].action, "choose");
  const row = communicationRows([], [candidate], [saved], { now })[0];
  assert.equal(row.status, "Selected");
  assert.equal(row.action, undefined);
  assert.equal(row.detail, "Review to connect.");
  const different = { ...candidate, endpoint: "http://127.0.0.1:18008" };
  assert.equal(communicationRows([saved], [different], [], { now })[1].action, "choose");
});
test("saved offline, stopped, stale, unauthenticated and incomplete resources never offer reconnect or claim live connectivity", () => {
  for (const [item, status] of [
    [{ ...saved, observation: { ...observation, reachable: false } }, "Connection saved · unavailable"],
    [{ ...saved, mode: "install", installed: true, running: false, config: { port: 19408 } }, "Stopped"],
    [{ ...saved, stale: true }, "Connection saved · checking"],
    [{ ...saved, observation: { ...observation, permission: "credential-required" } }, "API available · sign in required"],
    [{ ...saved, partial: true }, "Setup incomplete"],
  ]) {
    const row = communicationRows([item], [], [], { now })[0];
    assert.equal(row.status, status);
    assert.equal(row.action, "manage");
  }
  assert.equal(communicationRows([saved], [], [], { now: now + 31000 })[0].status, "Connection saved · checking");
});
test("matching keeps components and endpoint identities separate and refuses stale discovery choices", () => {
  const other = { ...candidate, componentId: "hermes" };
  assert.equal(communicationRows([saved], [other], [], { now }).length, 2);
  assert.equal(serviceEndpoint({ ...saved, config: { endpoint: "http://127.0.0.1:8008/private" } }), null);
  assert.equal(communicationRows([], [candidate], [], { now: now + 31000 })[0].action, undefined);
});
