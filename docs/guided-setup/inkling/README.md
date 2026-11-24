# Optional Inkling inference for Hermes

Hermes remains the Hub guide/agent; Inkling supplies inference. Existing Qwen suggestions, cloud choices, saved profiles and defaults stay unchanged. Inkling is experimental, explicitly selected and never recommended automatically. It is not required to finish onboarding. No dedicated Inkling UI/card work was added.

## Use the existing flow

Choose Run an open model → Choose another model → Inkling 2 Mini, then review/apply. Unsupported machines show a memory/platform explanation. Review discloses quantization, both publishers, immutable source, download bytes, engine revision, destinations, memory breakdown and required free space. Merely browsing the catalog performs no download, engine installation, inference or active-model change.

For an existing server, use the normal model-server connection and load its model list. Use an Inkling-2-Mini model ID. For opaque aliases, the persisted configuration accepts the additive modelFamily: "inkling-2-mini" hint. Saved credential references resolve privately for discovery, metadata checks and apply; keys never enter review/browser drafts. HTTP is loopback-only; remote HTTPS retains existing DNS/redirect protections.

The external experimental profile is the Unsloth root UD-Q4_K_XL / engine pair below. Its authenticated /props must identify the loaded model and report default_generation_settings.n_ctx >= 64000 per slot. Advertised/training maximum context and an owner-entered number are insufficient. Review checks metadata; apply rechecks and sends one bounded synthetic chat probe before selecting the model. No page/conversation data enters that probe. Other engine/quantization combinations, hidden metadata and Tinker's hosted API are unqualified. Observed metadata is not cryptographic attestation of remote weight bytes.

## Exact pair

The machine-readable source is [hermes-models.json](../../../profiles/setup/hermes-models.json).

| Component | Pin |
| --- | --- |
| Original publisher | Thinking Machines Lab |
| Original checkpoint | thinkingmachines/Inkling-2-Mini @ ed40e7da625f594fc9c4990f5f66be24873c22d7 |
| Quantization publisher | Unsloth |
| GGUF repository | unsloth/Inkling-2-Mini-GGUF @ ea0c79b2ecd73669e774c8519b79bfabfddbc027 |
| Text weights | Inkling-2-Mini-UD-Q4_K_XL.gguf; 17,629,759,456 bytes |
| Weight SHA256 | e62d463c135ffe283df8d94b279a96ca145ac128b52ce854478613045bf4de15 |
| Runtime | Unsloth llama.cpp b12588-mix-c0c3de8; darwin-arm64 |
| Release tag target | e854428673114be17c32272440a43f4b4ebd20b8 |
| Observed binary build identifier | 12588 / 883286076; Compiled by the Unsloth team |
| Runtime archive | llama-b12588-mix-c0c3de8-bin-macos-arm64.tar.gz; 13,114,900 bytes |
| Runtime SHA256 | 229def18e27ed740ec4f3a6508f084b25630e08d8a87ada40b00622fc496ceb8 |

The archive was hashed in memory and matched GitHub's asset digest. Release tag target and observed binary build identifier are recorded separately: we do not claim reproducible source-to-binary correspondence. The archive SHA256 fixes binary identity.

Root GGUFs use Unsloth's looped-layer layout (GGUF architecture: inkling2). Mainline_Support/*.gguf_file uses different upstream tensor names/metadata. Mainline additionally needs PR #32704 for correct per-expert NVFP4 scales on repeated loop passes; that fix was open when inspected. The adapter rejects substituting that layout or another engine pin.

The profile is text-only, with no required companion. Vision projector and DSpark drafter are deliberately excluded. The embedded template uses --jinja; sampling is temperature 1, top-p 1, top-k 0, min-p 0. Other combinations need independent qualification.

## Memory, context, disk and ownership

The official checkpoint recommends at least 32 GB on Apple silicon. The managed profile conservatively requires 32 GiB physical RAM and checks currently available RAM, including other running services.

Preflight prices all weight bytes, 8 full-attention and 40 local-attention loop applications, f16 K+V (8 KV heads × 128 dimensions × 2 tensors × 2 bytes), a 65,536-token full cache, 1,024-token local windows, 4 GiB runtime/buffer allowance and at least 6 GiB system reserve. Estimated working set is about 22.6 GiB before system/other-service reserve. This is configuration-derived, **not a measured 64K peak**. Active parameter count and model file size are not total memory requirements. Smaller quantizations have not been measured/selected.

The engine gets one fixed 65,536-token slot, f16 KV, batch 512 / microbatch 128, no vision/drafter and no automatic context growth/refit. Actual context and inference readiness must pass before retaining selection; failure restores the prior model configuration. Memory/free space are rechecked before launch.

Disk preflight includes missing weights, engine archive, 512 MiB extraction/staging allowance and 2 GiB headroom. Retained same-size weights must pass SHA256 before reducing the estimate. Native Hermes PM range-resume/checksum mechanisms are reused; the complete model is verified again before loading. Failed downloads remain for inspection/resume.

Weights use the instance's disclosed native Hermes directory. The separate engine lives at <instance>/runtimes/inkling/<archive-sha256>/; no global software or existing engine is replaced. The archive license stays with its libraries. Files and internal library links are inventoried/verified at boot. Copied adapter/catalog under <instance>/config are hash-bound in its receipt.

Native Hermes supervision, process identity, endpoint/API-key handling and resumable jobs remain authoritative. Other model choices use the original engine, presets and context policy. An authenticated idle Hub model adapter may refresh after a code/catalog change, but active/paused downloads and live inference runtimes block refresh. Hermes API processes are not restarted by that refresh.

## Qualification record — 2026-11-20

Machine: Apple M4 Pro, 24 GiB RAM. About 4.1 GiB free on /Volumes/home and the shared Local-Tooling-Runtime APFS pool; about 1.8 GiB on the system volume.

**No local Inkling model configuration has been qualified.** Full weights/inference were not attempted: this machine fails memory/disk preflight. No existing service or active provider was switched.

Actually checked:

- Pinned Apple-silicon engine unpacked via Hermes PM in an isolated temporary directory: archive hash, executable, libraries, --version and required --help options passed. No server started; temporary directory removed.
- Actual pinned Hermes AIAgent completed an inference turn against an isolated local OpenAI-compatible fixture, with expected response, no streaming and no tools.
- Live options retained Qwen3.5 9B as the machine suggestion; Inkling was not recommended and correctly failed the 24 GiB check. Saved OpenAI/Codex selection stayed unchanged.
- Fixtures cover wrong engine/layout, low memory/disk, actual per-slot context, discovery/auth, persistence, checksum tampering, resume accounting, runtime isolation and failed-readiness rollback.

Not qualified: real Inkling output, 64K allocation/peak RSS, latency, long prompts, streaming, tool calls, vision, speculative decoding, other quantizations/platforms or remote servers. The current Hub guide explicitly uses stream: false, tools: [] and tool_choice: "none"; those limits are preserved. A fixture/CLI check is not an onboarding-quality evaluation.

Before recommending it, use a sufficiently resourced isolated instance to measure peak memory at 65,536 served tokens, verify restart/switch-back, and compare multi-turn onboarding with corrections and simultaneous constraints against existing choices. The publisher reports multi-turn chat and complex-instruction limitations. Keep existing defaults until quality qualification passes.

## Sources

- [Release and limitations](https://thinkingmachines.ai/news/inkling-2-mini/)
- [Original model card](https://huggingface.co/thinkingmachines/Inkling-2-Mini)
- [Unsloth running guide](https://unsloth.ai/docs/models/inkling-2-mini)
- [Pinned GGUF repository](https://huggingface.co/unsloth/Inkling-2-Mini-GGUF/tree/ea0c79b2ecd73669e774c8519b79bfabfddbc027)
- [Mainline compatibility notes](https://huggingface.co/unsloth/Inkling-2-Mini-GGUF/blob/ea0c79b2ecd73669e774c8519b79bfabfddbc027/Mainline_Support/README.md)
- [Runtime release](https://github.com/unslothai/llama.cpp/releases/tag/b12588-mix-c0c3de8)


## Repeat validation

Run npm run test:setup, npm run typecheck and npm run check:source.
Run Python unittest for tests/test_inkling_runtime.py without native dependencies.
In the installed Hermes Python, run tests/test_hermes_model_manager.py too.
For the actual agent/fixture path, set HUB_TEST_HERMES_SOURCE to the verified pinned
Hermes source and run tests/test_hermes_inference_fixture.py in that environment.
The latter intentionally skips without an explicit native-source selection.
These checks do not qualify actual Inkling weights.


Observed live preflight: UD-Q4_K_XL, engine b12588-mix-c0c3de8, planned context
65,536; estimated working set 22.6 GiB; 18.9 GiB free required versus 4.1 GiB
available. It rejected memory and disk before any install. The cold adapter refresh
and preflight took about 96 seconds; this optional operation does not gate entering
the Hub with the existing provider.

Validation: setup suite plus private-binding persistence/protection tests;
18 installed-Hermes contract/runtime/inference checks passed. CI-equivalent Python
checks passed (53 passed, one native opt-in check skipped there and separately run
successfully in the installed Hermes environment). TypeScript, source provenance
and tracked-diff whitespace checks passed. No full-model qualification is implied.
