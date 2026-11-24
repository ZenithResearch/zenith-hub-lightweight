# Hermes model setup

Model configuration opens from Configure on welcome after a supported official Hermes installation has been verified. It edits the default provider/model configuration; new setup does not create a named guide profile or offer profile templates. The chosen path is reviewed and applied through one guided setup/start operation. After completion, Configure remains a secondary on-page action. Native contracts are pinned to `e5a86d08d3d8c5e2f61bc2e5354d96ba25a56f97` in NousResearch/hermes-agent.

## Cloud provider

The Hermes provider dropdown is the single provider selector. Its provider list and supported connection methods come from Hermes's native catalog.

- Claude: Anthropic API key. This Hermes version does not expose Claude subscription OAuth to a web dashboard; its external CLI setup remains separate.
- ChatGPT: native ChatGPT/Codex device sign-in. OpenAI API-key access is a separate provider choice.
- Grok: native xAI account sign-in; xAI API-key access is also available in the provider list.
- Gemini: Google AI Studio API key.
- Other providers expose the connection methods declared by the installed Hermes catalog.

Provider credentials stay in the verified installation’s native Hermes configuration and credential store. A Hub installation uses its private data directory. Reusing another compatible copy first reviews a binding to its existing default configuration directory; it does not copy credentials or history. Existing legacy named-profile bindings remain readable. They are excluded from Hub state, selections, review plans, browser drafts and responses. Device sign-in presents the vendor's HTTPS verification page and code; the user completes authentication there and checks its status on the welcome page. Saving a key or completing sign-in invalidates an earlier configuration review. After connection, the model list loads automatically and the draft prefers the currently saved model for that provider or Hermes’s native recommended default. The dropdown explains that this model answers future Hermes chats; manual model IDs are an advanced option. Approved sign-in codes and check/cancel controls disappear. The welcome review combines backend configuration and startup into one explicit operation; it stops the managed instance before changing its backend. Browsing or accepting the suggested draft does not change the running backend. A stored credential alone is not proof that a chat succeeds.

## Guided local setup

Four release-owned starting suggestions supplement Hermes's catalog without editing its installed source:

| Tier | Model | Starting memory band | Weight + companion download |
| --- | --- | --- | --- |
| Compact | Qwen3.5 4B Q4_K_M | Around 16 GB | 3.2 GiB |
| Balanced | Qwen3.5 9B Q4_K_M | Around 24–32 GB | 6.1 GiB |
| Larger | Qwen3.5 27B Q4_K_M | Around 48–64 GB | 16.5 GiB |
| Flagship Mac | Qwen3.5 397B-A17B Q4_K_M | 512 GB unified-memory Macs | 228.2 GiB |

These bands are guidance, not guarantees. Hermes estimates weights, context and runtime overhead using actual system/unified/GPU memory. The UI recommends the largest fitting suggestion without spilling; non-fitting options cannot be selected. If none fits, use a cloud provider or an existing model server. There is no automatic download based on the recommendation.

Review the selected model, exact source revisions/hashes, engine release/backend, destination, download size and free-space requirement on welcome. The reviewed setup operation prepares the private Hermes API when needed, stops it for the backend change, then uses Hermes's managed quickstart to install its runtime if needed, download weights and companion, verify SHA256 and start the local model server. Progress supports pause/resume while the operation remains owned by the controller. Model bytes, assets and server state belong to this instance's `data` directory. The same guided operation starts the Hermes API afterward and waits for authenticated readiness.

Preflight requires available space for missing artifacts plus 2 GiB of headroom. A memory or disk failure blocks Apply. Incomplete downloads stay retained; they are not reported as installed. Controller restart makes an unconfirmed operation explicit rather than claiming completion. Do not terminate or replace the private model manager while it owns a download or model server.

The model and quantization sources are declared honestly in `profiles/setup/hermes-models.json`: the 4B GGUF is published by ggml-org; the 9B and 27B GGUFs by Unsloth. Every weight/companion has an immutable source revision, size and SHA256. The flagship build has six split GGUFs plus a vision companion; every shard is checked before startup. MoE active-parameter count does not reduce the memory needed to hold the full weights. Its memory band targets [Apple’s 512 GB Mac Studio configurations](https://www.apple.com/mac-studio/specs/); this is a planning estimate, subject to the native check and available memory. The descriptive model cards are [Qwen 4B](https://huggingface.co/Qwen/Qwen3.5-4B), [Qwen 9B](https://huggingface.co/Qwen/Qwen3.5-9B) [Qwen 27B](https://huggingface.co/Qwen/Qwen3.5-27B) and [Qwen 397B-A17B](https://huggingface.co/Qwen/Qwen3.5-397B-A17B). Provider methods follow [Hermes's documentation](https://hermes-agent.nousresearch.com/docs/integrations/providers) and the pinned implementation.

## Existing model server

Provide an OpenAI-compatible server origin, such as `http://127.0.0.1:11434`, without `/v1`. Load its advertised models or enter its model ID directly. Set an optional served context window to match the server; this Hermes revision requires at least 64,000 tokens actually served. If authentication is required, use an owner-configured secret reference. Credentials for an old server are never used to browse another server's models.

Loopback HTTP and public HTTPS origins use the Hub's existing bounded, redirect-free request policy. Connecting does not install, adopt or restart the external server. Review the new backend on welcome and apply the combined configure/start operation. An optional reply verifies the chosen backend; it does not gate Hub entry.

## Implementation and compatibility

The Hub exposes a bounded `hermes-model` action vocabulary for metadata, credentials, native sign-in, model browsing, preflight and existing-job controls. Starting a local download or applying a model is not a direct browser action: it requires the existing plan/review/apply path. Plans bind catalog, adapter, source and manifest hashes.

The bridge runs under the installed managed Python environment on an authenticated owner-private Unix socket. It mounts only the narrow settings adapter, not Hermes's full dashboard, file browser, terminal or cron lifecycle. No existing personal profile, system keychain account or global model cache is adopted.

Legacy `backendKind`, `modelEndpoint`, `modelName`, `contextLength` and `secretRef` records remain readable. Optional `providerId` and `localModelId` fields extend that shape. Model catalog responses add optional `recommendedModel` and `currentModel` fields; older responses remain readable. Late catalog responses cannot overwrite a typed model or a draft for another provider/server. Native provider selection removes stale custom endpoint/credential/context overrides; managed local selection retains the context chosen by Hermes. API identity, unrelated settings and data remain with the same instance. Model changes clear previous chat-readiness proof.
