import test from "node:test";
import assert from "node:assert/strict";
import { hermesChatState } from "../../src/lib/setup/hermes-chat-state.mjs";
const now = Date.now();
const hermes = { instanceId: "guide", componentId: "hermes", mode: "install", installed: true, configured: true, running: true, config: { modelName: "selected-model" }, observation: { reachable: true, chatAvailable: true } };
const snapshot = { mode: "local", root: "/fixture", instances: [hermes] };
test("the Hermes receiver stays unavailable before configuration; the HUD shell is independent", () => {
  assert.equal(hermesChatState({ ...snapshot, instances: [] }, now).visible, false);
  assert.equal(hermesChatState({ ...snapshot, instances: [{ ...hermes, configured: false }] }, now).visible, false);
  assert.equal(hermesChatState({ ...snapshot, instances: [{ ...hermes, partial: true }] }, now).visible, false);
});
test("a live configured model enables chat regardless of the Hub page", () => {
  assert.equal(hermesChatState(snapshot, now).available, true);
  assert.equal(hermesChatState({ ...snapshot, instances: [{ ...hermes, mode: "connect", config: {} }] }, now).available, true);
});
test("saved Hermes remains available as a HUD when stopped or stale but cannot send", () => {
  const stopped = hermesChatState({ ...snapshot, instances: [{ ...hermes, running: false, observation: { reachable: false } }] }, now);
  assert.equal(hermesChatState({ ...snapshot, instances: [{ ...hermes, running: false }] }, now).available, false);
  assert.equal(stopped.visible, true); assert.equal(stopped.available, false); assert.match(stopped.status, /stopped/);
  assert.equal(hermesChatState(snapshot, now - 31000, now).available, false);
  assert.equal(hermesChatState({ ...snapshot, busy: true }, now).available, false);
});
test("model selection and resource identity are required before sending", () => {
  assert.equal(hermesChatState({ ...snapshot, instances: [{ ...hermes, config: {} }] }, now).available, false);
  assert.notEqual(hermesChatState(snapshot, now).identity, hermesChatState({ ...snapshot, root: "/another-profile" }, now).identity);
});
