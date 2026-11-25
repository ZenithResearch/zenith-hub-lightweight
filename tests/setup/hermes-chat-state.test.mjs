import test from "node:test";
import assert from "node:assert/strict";
import { hermesChatState, hermesQuickTargets } from "../../src/lib/setup/hermes-chat-state.mjs";
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


test("the dial lists only actual configured receivers and targets an explicit choice",()=>{
 const second={...hermes,instanceId:"coding",config:{...hermes.config,label:"Coding"}};
 const s={...snapshot,welcomeTargetId:"guide",instances:[hermes,second,{...hermes,instanceId:"disabled",enabled:false},{...hermes,instanceId:"unfinished",configured:false}]};
 const targets=hermesQuickTargets(s);
 assert.deepEqual(targets.map(t=>t.id),["guide","coding"]);assert.equal(targets[1].label,"Coding");assert.notEqual(targets[0].color,targets[1].color);
 assert.equal(hermesChatState(s,now).instance.instanceId,"guide");
 assert.equal(hermesChatState(s,now,now,"coding").instance.instanceId,"coding");
 assert.equal(hermesChatState(s,now,now,"disabled").available,false);
 assert.equal(hermesChatState(s,now,now,"missing").available,false);
 assert.deepEqual(hermesQuickTargets({...s,mode:"remote"}),[]);
});

test("a disappeared or changed receiver never silently retargets an in-flight input",()=>{
 const second={...hermes,instanceId:"coding"},s={...snapshot,instances:[hermes,second]};
 const selected=hermesChatState(s,now,now,"coding");
 const removed=hermesChatState(snapshot,now,now,selected.instance.instanceId);
 assert.equal(removed.available,false);assert.notEqual(removed.identity,selected.identity);
 assert.equal(hermesChatState({...s,instances:[hermes,{...second,partial:true}]},now,now,"coding").available,false);
});
