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

To install a new Mac, launch Hub and choose **Install base stack**. Hub first
shows the destination and pinned manifest digest. Only **Apply** downloads the
released installer, verifies its archive and full wheel closure, and installs it.
Opening Hub or reviewing an install does not install or start any components.
The default installer uses normalized Zenith Service and Runtime projections.

The [onboarding release](https://github.com/ZenithResearch/zenith-hub-lightweight/releases/tag/hub-onboarding-2026.11.19)
also carries the offline Apple-silicon ZIP and SHA256SUMS. An explicitly configured
`ZENITH_PROCESS_BUNDLE` continues to use a reviewed local bundle instead.
Installation leaves native authority pending; starting the installed components
is a separate reviewed action.

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

The unreleased `workspace-provider-v1` profile is the reviewed provider release
candidate. It pins the exact Service Management, Process Runtime, Frank,
Castalia Wallet and secS source heads and includes six native tools for Wallet
command/setup, Runtime context verification, encrypted intake opening and
connector-result setup/attestation. Its presence in source does not publish,
install or activate those bytes; use the provider activation runbook only with
the separately verified bundle digest.

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
- [Castalia Wallet](https://github.com/ZenithResearch/castalia-wallet)

The roadmap is a separate read-only observer with synthetic public examples;
SDK generalization remains tracked separately from this deployer. Wallet source is public with its own verification and disclosure evidence; it is
not installed or enrolled by this bundle.

## Local typed object storage

Hub can optionally persist JSON-LD/RDF objects in its own SQLite database, separate
from connection configuration and provider data. The owner CLI supports imports,
exports and revision-checked updates. See [the storage contract and walkthrough](docs/object-store.md).
Run `npm run test:objects` and `node scripts/objects-roundtrip.mjs` for the isolated
semantic round-trip acceptance checks. The feature requires explicit owner data
directory configuration; opening onboarding does not initialize an object store.

The proposed [Hub Infrastructure extension](docs/infrastructure/README.md) adds offline-verified environment schemas and portable profile bundles to the optional object store. It does not provision services or change normalized Core.
