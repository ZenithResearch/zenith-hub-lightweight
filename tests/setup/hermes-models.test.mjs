import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadCatalog, resolveSelection } from "../../src/lib/setup/catalog.mjs";
import { validateModelRequest, idleModelManager } from "../../src/lib/setup/hermes-models.mjs";
test("model action contract bounds credentials and forbids arbitrary operations, profile paths and direct download starts", () => {
  const valid = { action: "connect-key", providerId: "anthropic", apiKey: "fixture-only-key" };
  assert.equal(validateModelRequest(valid), valid);
  for (const request of [
    { ...valid, profile: "/another-profile" }, { ...valid, apiKey: "bad\nvalue" },
    { ...valid, providerId: "../other" }, { action: "run", command: "arbitrary" },
    { action: "local-start", modelId: "qwen35-4b" },
    { action: "apply-backend", providerId: "anthropic" },
    { action: "options", extra: true }, { action: "models" },
    { action: "endpoint-models", endpoint: "http://user:secret@127.0.0.1:19343" },
  ]) assert.throws(() => validateModelRequest(request));
  assert.equal(validateModelRequest({ action: "endpoint-models", endpoint: "http://127.0.0.1:19343" }).action, "endpoint-models");
});
test("existing presets and optional Inkling pin every downloaded weight and companion", async () => {
  const manifest = JSON.parse(await readFile("profiles/setup/hermes-models.json", "utf8"));
  assert.equal(new Set(manifest.models.map((m) => m.id)).size, 5);
  assert.deepEqual(manifest.models.filter((m) => m.catalog.recommend).map((m) => m.id),
    ["qwen35-4b", "qwen35-9b", "qwen35-27b", "qwen35-397b-a17b"]);
  const inkling = manifest.models.find((m) => m.id === "inkling-2-mini");
  assert.equal(inkling.publisher, "Thinking Machines Lab");
  assert.equal(inkling.quantizationPublisher, "Unsloth");
  assert.equal(inkling.license, "Apache-2.0");
  assert.equal(inkling.qualification.status, "not-qualified");
  assert.equal(inkling.catalog.variants[0].validated, false);
  assert.match(inkling.managed.engine.commit, /^[a-f0-9]{40}$/);
  assert.match(inkling.managed.engine.sha256, /^[a-f0-9]{64}$/);
  assert.ok(inkling.managed.engine.size_bytes > 0);
  const flagship = manifest.models.find((m) => m.id === "qwen35-397b-a17b");
  assert.equal(flagship.catalog.variants[0].files.length, 6);
  assert.equal(flagship.catalog.moe, true);
  for (const model of manifest.models) {
    assert.match(model.modelCard, /^https:\/\/huggingface.co\/(Qwen|thinkingmachines)\//);
    const entry = model.catalog;
    assert.match(entry.repo, /^(ggml-org|unsloth)\//);
    for (const artifact of [...entry.variants.flatMap((v) => v.files), ...(entry.mmproj ? [entry.mmproj] : [])]) {
      assert.match(artifact.revision || entry.revision, /^[a-f0-9]{40}$/);
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      assert.ok(artifact.size_bytes > 0);
    }
  }
});

test("every displayed preset is accepted by the persisted Hermes setup schema", async () => {
  const registry = await loadCatalog();
  const manifest = JSON.parse(await readFile("profiles/setup/hermes-models.json", "utf8"));
  for (const model of manifest.models) {
    const [resolved] = resolveSelection(registry, [{ instanceId: "preset-test", componentId: "hermes", mode: "install", config: { port: 19499, providerId: "llamacpp", localModelId: model.id } }]);
    assert.equal(resolved.config.localModelId, model.id);
  }
});

test("adapter refresh refuses active/paused downloads and live inference runtimes", () => {
  assert.equal(idleModelManager([], false), true);
  assert.equal(idleModelManager([{status:"done"}], false), true);
  assert.equal(idleModelManager([], true), false);
  assert.equal(idleModelManager([{status:"running"}], false), false);
  assert.equal(idleModelManager([{status:"paused"}], false), false);
  assert.equal(idleModelManager(null, false), false);
});
