# Zenith Hub lightweight deployer

Public baseline: [ZenithResearch/zenith-hub-lightweight](https://github.com/ZenithResearch/zenith-hub-lightweight).
Deployment component: [zenith-ui-deployment](https://github.com/ZenithResearch/zenith-ui-deployment).

A separate frontend and local operator bridge for setting up and monitoring an
Apple silicon Mac. This repository does not change the official Hub configuration.
Devgraph owns work tracking. The separate roadmap project is a read-only frontend
SDK, with further generalization tracked in `Task/create-general-roadmap-repository`.

## Run on your Mac

Prerequisites: Node.js 24 or later, npm, and Python 3.12. The installed Process
profile requires macOS on Apple silicon. No VM or Docker is required.

```sh
npm ci
cp .env.operator.example .env.operator.local
# Edit .env.operator.local if using a new installation/bundle or alternate ports.
npm run build
npm run operator:start
```

Open **http://127.0.0.1:4208**. By default the controller inspects the existing
installation at `~/Library/Application Support/Zenith/Process`. All configuration
for this UI lives in the ignored `.env.operator.local`; use absolute paths.
`npm run operator` runs the same loopback bridge in development mode.

To install a new Mac, set `ZENITH_PROCESS_BUNDLE` to the extracted, reviewed offline
Mac bundle and `ZENITH_PROCESS_ROOT` to its final, absent destination. Click
**Install base stack**, review the destination and manifest digest, then apply.
The server requires the exact repository-pinned release profile and the Python
controller checks every bundle payload. Existing data is never overwritten.
Download the [Apple-silicon base installer](https://github.com/ZenithResearch/zenith-hub-lightweight/releases/tag/mac-base-2026.10.16) and verify its ZIP with the release’s `SHA256SUMS`. The release includes the offline wheel closure and exact public component commit/hash pins. This is a base-installation prerelease; native authority remains pending.

Use **Run doctor**, **Start**, **Stop** and **Refresh status** to manage that one
installation. Status refreshes every 15 seconds while the tab is visible.
Every operation requires a short-lived, one-use review. Start/stop target only
the selected installation's owned user launchd jobs.

## What works now

The UI installs the pinned base packages and manages Service Management and Process
Runtime. Frank is installed with no enabled actors; it is not an HTTP daemon.
The current profile reports native authority pending and external effects disabled.
Installation and liveness do not mean the environment can receive useful requests.
Native authority, Matrix request intake, a qualified live provider and the first
end-to-end workflow remain separate checkpoints.

A hosted copy is a frontend only: local operations are disabled unless explicitly
launched as the local operator on an Apple silicon Mac. Do not expose or proxy the
operator server beyond loopback. No browser token, native key, command string,
secret, policy or arbitrary filesystem path is accepted as a deployment input.

## Verify

```sh
npm run check:source
npm run test:deployer
npm run typecheck
npm run build
```

See [the operator contract](docs/local-operator.md) and
[the publication checklist](docs/publication.md). The presentation component is
imported from a committed ZenithUI source snapshot; hashes are recorded in
`profiles/source-provenance.json`. The former canvas/review-uploader entrypoint is
replaced by this deployment UI; there is no official-Hub upload dependency.

This source baseline preserves the existing unlicensed project status; public
visibility does not grant a new open-source license. See [NOTICE.md](NOTICE.md).

## Component sources

- [Process Runtime](https://github.com/ZenithResearch/process-runtime)
- [Service Management](https://github.com/ZenithResearch/service-management)
- [Frank executor](https://github.com/ZenithResearch/frank-executor)
- [Devgraph roadmap demo](https://github.com/ZenithResearch/devgraph-roadmap)

The roadmap is a separate read-only observer with synthetic public examples;
SDK generalization remains tracked separately from this deployer. Wallet source
publication is checked independently; it is not installed or enrolled by this bundle.
