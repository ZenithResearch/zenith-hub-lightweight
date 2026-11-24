import test from "node:test";
import assert from "node:assert/strict";
import {
  welcomeState,
  welcomeLandingState,
} from "../../src/lib/setup/welcome-state.mjs";
test("welcome begins on the background for absent, installed and multiple-profile states", () => {
  assert.equal(welcomeLandingState(null).state, "checking");
  assert.equal(welcomeLandingState({ instances: [] }).state, "install");
  const machine = { instances: [], hermesInstallations: [{ id: "native" }] };
  assert.equal(welcomeLandingState(machine).label, "Continue");
  const profile = {
    componentId: "hermes",
    instanceId: "guide",
    installed: true,
    configured: false,
  };
  assert.equal(
    welcomeLandingState({ instances: [profile] }).state,
    "configure",
  );
  const multiple = {
    instances: [profile, { ...profile, instanceId: "second" }],
  };
  assert.equal(welcomeState(multiple).phase, "choose-instance");
  assert.equal(welcomeLandingState(multiple).state, "configure");
});
test("retained operations offer an explicit progress action without hiding their state", () => {
  const instance = {
    componentId: "hermes",
    instanceId: "guide",
    installed: false,
    partial: true,
  };
  const state = {
    instances: [instance],
    operations: [{ id: "op", instanceIds: ["guide"], state: "applying" }],
  };
  assert.equal(welcomeLandingState(state).label, "View progress");
  assert.equal(
    welcomeLandingState({
      ...state,
      operations: [{ ...state.operations[0], outcomeUnknown: true }],
    }).label,
    "Review retained progress",
  );
  assert.equal(
    welcomeLandingState({ instances: [instance] }).label,
    "Resume installation",
  );
});
test("configured availability and chat evidence do not determine the Continue action", () => {
  const instance = {
    componentId: "hermes",
    instanceId: "guide",
    installed: true,
    configured: true,
    backendConfigured: true,
    profile: { name: "hub-guide" },
    config: { modelName: "model" },
    running: false,
  };
  assert.equal(
    welcomeLandingState({ instances: [instance] }).label,
    "Continue",
  );
  assert.equal(
    welcomeLandingState({
      instances: [{ ...instance, backendConfigured: false }],
    }).label,
    "Continue",
  );
});
