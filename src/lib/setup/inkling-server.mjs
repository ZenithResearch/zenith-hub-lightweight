/** Read-only metadata first; synthetic inference only after the reviewed apply.
 * This validates an observed server configuration, not remote weights attestation.
 */
import { requestJSON } from "./network.mjs";

export const isInkling = (config) => config.modelFamily === "inkling-2-mini" || /inkling[-_ .]?2[-_ .]?mini/i.test(config.modelName || "");
export async function inspectInklingServer(config, { token, request = requestJSON, infer = false } = {}) {
  const prerequisites = [];
  const fail = (text) => ({ prerequisites: [text] });
  const minimum = 64000;
  try {
    const listing = await request(config.modelEndpoint, "/v1/models", { token, timeout: 10000 });
    if (listing.status !== 200 || !listing.value?.data?.some((m) => m.id === config.modelName))
      return fail("Inkling model discovery failed. Check the exact served model ID and credential reference.");
    const props = await request(config.modelEndpoint, "/props?model=" + encodeURIComponent(config.modelName) + "&autoload=false", { token, timeout: 10000 });
    if (props.status !== 200)
      return fail("Load Inkling on the existing server and expose authenticated llama.cpp /props metadata. Advertised model context alone is insufficient. Tinker is not assumed to provide this API.");
    const p = props.value;
    const served = p.default_generation_settings?.n_ctx;
    if (!Number.isSafeInteger(served) || served < minimum)
      prerequisites.push("Hermes needs at least 64,000 tokens per served slot. This server does not report that window in its actual generation settings.");
    if (config.contextLength && (config.contextLength < minimum || config.contextLength > served))
      prerequisites.push("The requested Hermes context must be at least 64,000 and no larger than the server's actual per-slot context.");
    // Unsloth root files + exact reviewed build. Mainline needs a different
    // tensor layout AND an upstream correctness fix; version number alone fails.
    if (!/(?:883286076)/i.test(String(p.build_info || "")) ||
        !/Inkling-2-Mini-UD-Q4_K_XL\.gguf$/i.test(String(p.model_path || "")))
      prerequisites.push("This Inkling engine/quantization combination is unqualified. Use the reviewed Unsloth b12588-mix-c0c3de8 build with its root UD-Q4_K_XL GGUF; Mainline_Support files are different.");
    if (typeof p.model_alias === "string" && p.model_alias !== config.modelName)
      prerequisites.push("Server metadata describes a different model alias. Use its exact discovered ID.");
    if (prerequisites.length) return { prerequisites };
    if (infer) {
      const result = await request(config.modelEndpoint, "/v1/chat/completions", {
        method: "POST", token, timeout: 180000,
        body: { model: config.modelName, messages: [{ role: "user", content: "Reply with INKLING_OK." }],
                stream: false, tools: [], tool_choice: "none", max_tokens: 256, temperature: 1.0 },
      });
      if (result.status !== 200 || !result.value?.choices?.[0]?.message?.content?.trim())
        return fail("Inkling did not return a usable OpenAI-compatible chat reply. The previous Hermes model has been retained.");
    }
    return { prerequisites, contextLength: config.contextLength || served, servedContext: served,
             engine: "Unsloth b12588-mix-c0c3de8", quantization: "UD-Q4_K_XL", qualification: "experimental; not onboarding-quality qualified" };
  } catch {
    return fail("The Inkling server could not be verified. Check its address, authentication, model ID and live /props configuration.");
  }
}
