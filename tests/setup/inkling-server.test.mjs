import test from "node:test";
import assert from "node:assert/strict";
import { inspectInklingServer, isInkling } from "../../src/lib/setup/inkling-server.mjs";
import { loadCatalog, resolveSelection, normalizeHermesBackend } from "../../src/lib/setup/catalog.mjs";

const config = { providerId: "custom", modelName: "Inkling-2-Mini", modelEndpoint: "https://model.example", contextLength: 65536 };
const props = { default_generation_settings: { n_ctx: 65536 }, model_alias: config.modelName,
  build_info: "1.0.0-dev (build 12588, commit 883286076)", model_path: "/models/Inkling-2-Mini-UD-Q4_K_XL.gguf" };
function fixture({ metadata = props, chat = { choices: [{ message: { content: "INKLING_OK" } }] }, status = 200 } = {}) {
  const calls = [];
  const request = async (_endpoint, route, options) => {
    calls.push({ route, ...options });
    return route === "/v1/models" ? { status, value: { data: [{ id: config.modelName }] } }
      : route.startsWith("/props?") ? { status, value: metadata } : { status, value: chat };
  };
  return { calls, request };
}
test("Inkling metadata review checks actual served context and never performs inference", async () => {
  const f = fixture();
  const result = await inspectInklingServer(config, { request: f.request, token: "fixture-key" });
  assert.deepEqual(result.prerequisites, []);
  assert.equal(result.servedContext, 65536);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((c) => c.token === "fixture-key" && !c.body));
  assert.ok(!JSON.stringify(result).includes("fixture-key"));
});
test("advertised million-token context cannot replace 64K actual per-slot context", async () => {
  for (const metadata of [
    { ...props, default_generation_settings: { n_ctx: 32768 }, max_model_len: 1048576 },
    { ...props, default_generation_settings: {}, n_ctx_train: 1048576 },
  ]) {
    const f = fixture({ metadata });
    assert.ok((await inspectInklingServer(config, f)).prerequisites.some((p) => p.includes("64,000")));
    assert.equal(f.calls.length, 2);
  }
  const f = fixture();
  assert.ok((await inspectInklingServer({ ...config, contextLength: 131072 }, f)).prerequisites.length);
});
test("wrong model, incompatible layout/build, unavailable API and Tinker-style responses are rejected", async () => {
  for (const metadata of [{ ...props, build_info: "b11671" }, { ...props, model_path: "/Mainline_Support/model.gguf_file" },
                          { ...props, model_alias: "different" }]) {
    assert.ok((await inspectInklingServer(config, fixture({ metadata }))).prerequisites.length);
  }
  assert.ok((await inspectInklingServer(config, fixture({ status: 401 }))).prerequisites.length);
  assert.ok((await inspectInklingServer(config, { request: async () => { throw Error("private-key-and-provider-body"); } })).prerequisites.length);
});
test("reviewed apply sends a bounded synthetic no-tool non-streaming chat before configuration", async () => {
  const f = fixture();
  assert.deepEqual((await inspectInklingServer(config, { ...f, infer: true })).prerequisites, []);
  assert.equal(f.calls[2].body.stream, false);
  assert.deepEqual(f.calls[2].body.tools, []);
  assert.equal(f.calls[2].body.tool_choice, "none");
  assert.equal(f.calls[2].body.messages[0].content, "Reply with INKLING_OK.");
  assert.ok((await inspectInklingServer(config, { ...fixture({ chat: { choices: [{ message: { content: "" } }] } }), infer: true })).prerequisites.length);
});
test("Inkling family is additive, persists for aliases, and is removed from unrelated providers", async () => {
  assert.equal(isInkling(config), true);
  assert.equal(isInkling({ modelName: "alias", modelFamily: "inkling-2-mini" }), true);
  assert.equal(isInkling({ modelName: "Qwen3.5" }), false);
  const registry = await loadCatalog();
  const [row] = resolveSelection(registry, [{ instanceId: "inkling-test", componentId: "hermes", mode: "install",
    config: { ...config, modelFamily: "inkling-2-mini", port: 19499 } }]);
  assert.equal(row.config.modelFamily, "inkling-2-mini");
  assert.equal(row.config.contextLength, 65536);
  assert.equal(normalizeHermesBackend({ providerId: "anthropic", modelFamily: "inkling-2-mini" }).modelFamily, undefined);
});
