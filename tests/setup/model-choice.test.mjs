import test from "node:test";
import assert from "node:assert/strict";
import { modelChoiceKey, withSuggestedModel, withDefaultConfiguration } from "../../src/lib/setup/model-choice.mjs";
const choice = { providerId: "openai-codex", modelName: "" };
const catalog = { models: ["expensive-first", "native-default", "saved-model"], recommendedModel: "native-default" };
test("provider suggestions use Hermes's default rather than the first catalog entry", () => {
  assert.equal(withSuggestedModel(choice, choice, catalog).modelName, "native-default");
  assert.equal(withSuggestedModel(choice, choice, { ...catalog, currentModel: "saved-model" }).modelName, "saved-model");
  assert.equal(withSuggestedModel(choice, choice, { models: catalog.models }), choice);
  assert.equal(withSuggestedModel(choice, choice, { ...catalog, recommendedModel: "unavailable" }), choice);
});
test("a catalog response never overwrites a model the user selected while loading", () => {
  const edited = { ...choice, modelName: "owner-selected-model" };
  assert.equal(withSuggestedModel(edited, choice, catalog), edited);
});
test("a late response cannot change the next provider's draft", () => {
  const changed = { ...choice, providerId: "gemini" };
  assert.equal(withSuggestedModel(changed, choice, catalog), changed);
});
test("existing server catalogs and suggestions stay scoped to their endpoint", () => {
  const first = { providerId: "custom", modelEndpoint: "http://127.0.0.1:19343" };
  const second = { ...first, modelEndpoint: "http://127.0.0.1:11434" };
  assert.notEqual(modelChoiceKey("same-instance", first), modelChoiceKey("same-instance", second));
  assert.equal(withSuggestedModel(second, first, catalog), second);
});

test("default settings hydrate only an untouched form and normalize a native API base", () => {
 const native={providerId:"custom",modelName:"saved",modelEndpoint:"http://127.0.0.1:19343/v1/",contextLength:65536,api_key:"never-copy"};
 assert.deepEqual(withDefaultConfiguration({},native),{providerId:"custom",modelName:"saved",modelEndpoint:"http://127.0.0.1:19343",contextLength:65536});
 const edited={providerId:"gemini",modelName:""};assert.equal(withDefaultConfiguration(edited,native),edited);
 assert.deepEqual(withDefaultConfiguration({},{...native,providerId:"gemini"}),{providerId:"gemini",modelName:"saved"});
});
