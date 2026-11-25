# Guided component setup (unreleased review branch)

The released onboarding at port 4218 remains independent. Test this branch with Node 24, a numeric-loopback origin and a fresh `ZENITH_HUB_SETUP_DIR`. `/legacy` retains the old installer. `ZENITH_GUIDED_SETUP=0` disables the new flow. Never reuse the pending Process-SAI destination for qualification.

The welcome-screen journey is implemented in this review branch: initial actions sit directly on the artwork; expanded installation/configuration uses one modal on the same canvas. See [Welcome-screen Hermes onboarding](onboarding-flow.md). The Matrix and other component adapter notes below are retained implementation references, outside this welcome flow.

## Prerequisites and source ownership

- The Hub operator requires Node 24. Hermes installation prepares a Hub-managed Python bootstrap from a pinned vendor archive and verified file inventory; no Homebrew Python is required. An explicit owner-supplied `ZENITH_SETUP_PYTHON` remains supported as a Python 3.12 override. Other component adapters retain their own prerequisites.
- Native Matrix currently supports Apple silicon macOS with Apple Command Line Tools and Rust stable installed by the owner. `ZENITH_SETUP_RUSTC` can select rustc. Review records compiler paths, versions and hashes. Hub does not silently install system developer tools.
- At least 1 GiB free is required for the Matrix build; allow additional space for installed packages, data and retained failed generations. Hermes source, tools, dependencies and logs also need private disk space.
- Service Management, Runtime and Frank retain exact release source commits. Devgraph connections do not adopt its process or data. Hermes is installed from the official `NousResearch/hermes-agent` product, pinned to e5a86d08d3d8c5e2f61bc2e5354d96ba25a56f97, using its PM build API and frozen uv.lock.

## Journey: installation, Hub entry and optional guide setup

1. Open `/` or `/setup`. If Hermes is absent, welcome offers **Install Hermes** on the background; selecting it opens the source-install review modal.
2. Once installed, show the original cloud entry screen with **Continue** and secondary **Configure** directly on the background. Entry opens `/hub`; no test message, provider connection or backend invocation is required to enter.
3. **Configure** opens the default provider/model settings directly in the welcome modal. New setup creates no named Hermes profile and offers no profile/template selector.
4. Choose a native AI provider, a guided open model or an existing model server. Review and apply configuration/startup. Authenticated health and capabilities establish live chat availability; no automatic model request is sent.
5. Return to the normal entry screen after configuration. The floating Hermes pill is the message field itself. Type and press Enter or its send arrow; only the latest reply appears in a heading-free glass panel above that field, then fades after its reading time at 80 words per minute. Its caret reopens the latest reply; dot minimization and Escape preserve the draft.
6. A successful optional reply records configuration-bound chat verification evidence. It does not unlock or gate Hub entry. Reloads retain installation/configuration and durable operation records; live availability remains separate.

Installed software is discovered read-only from the Hermes launcher and conventional source-install locations; no shell launcher is executed for detection. Reuse is admitted only after the supported revision, pinned native contract files and Python runtime are verified. A detected but unsupported installation is shown as installed with a compatibility explanation, rather than reported absent.

Configuration uses the installation's default Hermes configuration (`instances/<instance>/data` for a Hub install). Reusing compatible software first reviews a binding to its existing default configuration directory; it does not copy credentials/history or invoke native profile creation. Native provider settings and the Hub's API settings are merged without replacing unrelated configuration. Existing saved named-profile bindings remain readable and retain their original configuration home. The application database continues storing the default configuration using its existing configuration-record schema; no new ontology type or database migration is introduced.

The normal source URL is the official Nous repository. The recorded revision is `e5a86d08d3d8c5e2f61bc2e5354d96ba25a56f97`, verified as an ancestor of official main during this change. The official codeload archive is SHA256-pinned and all 4,475 admitted files are checked. This is a recorded compatible revision, not an assertion that it is the latest upstream head.

An owner may supply public source/tool artifact caches for qualification using `ZENITH_SETUP_HERMES_SOURCE_CACHE` and `ZENITH_SETUP_HERMES_TOOL_CACHE`. These never supply profiles or credentials; their inventories are verified. A failed cache check stays a failed installation.

## Hermes chat across the Hub

Once a managed Hermes installation is configured, or an external Hermes connection is saved, the global layout starts with a floating icon-free glass dot control on welcome and all other Hub pages. Clicking it expands the glass message-input pill. Type directly into the pill; only the latest response appears after an explicit send, then fades after its 80-word-per-minute reading interval. The input's leading status dot collapses it into the circle. Escape first hides a visible response, then collapses an input-only pill. The same guide moves inside the welcome modal while it is open, retaining its draft, latest response and collapsed state; dismissal returns it to the global layer. A browser reload starts a new displayed conversation. A different setup root or Hermes instance starts a separate conversation.

The configured model supplies replies through the existing authenticated setup-chat API. Opening the panel does not send a message. Sending is disabled for a stopped service, missing model, stale/unreachable connection or active setup operation. The saved panel remains accessible with its connection status and offline help. Chat remains advisory; installation and configuration continue through reviewed actions. Only the latest reply is displayed locally; the existing chat API sends each question independently.

## Live first-run walkthrough

The November 20 preview was reset after saving a private backup of the test settings and operational data. Its disposable Matrix/Hermes services and helper model were stopped, and their test software/cache directories were removed. Personal services, the released Hub and the separate SAI Devgraph were left outside that reset. Fresh onboarding uses no restored credentials, preselected connections or copied profiles.

For live development, launch from this checkout with a fresh setup root:

```sh
ZENITH_PREVIEW_BUILD=1 \
ZENITH_DEV_BUNDLER=webpack \
ZENITH_OPERATOR_PORT=4318 \
ZENITH_HUB_SETUP_DIR=/Volumes/home/bananawalnut/Zenith/Hub-Walkthrough-20261120 \
ZENITH_SETUP_PYTHON= \
ZENITH_SETUP_HERMES_SOURCE_CACHE= \
ZENITH_SETUP_HERMES_TOOL_CACHE= \
node scripts/operator.mjs
```

`ZENITH_DEV_BUNDLER=webpack` selects stable live reload for this walkthrough; production builds retain their existing bundler. Preview output uses `.next-preview`, separately from the production `.next` directory. Open <http://127.0.0.1:4318/>. With the fresh root, the only welcome action is **Install Hermes** and the chat is absent until configuration. Stop here and walk through the reviewed actions with the owner; do not pre-apply the install or provider login.

## Journey: Matrix from an empty artifact cache

1. Choose Matrix, a disposable development name for testing or an owned permanent server name, a new instance name/free port and private access. A server name is the identity part of Matrix user IDs and cannot be renamed after provisioning. Confirm the identity checkbox.
2. Select **Review Matrix artifact preparation**. Review `matrix-build.json`: exact official PyPI URLs, SHA256/size pins for 58 runtime wheels, the Synapse 1.165.0 source archive, maturin 1.16.0 and compiler provenance.
3. Apply preparation. Downloads and builds occur only after this action. Cargo uses the source's Cargo.lock checksums and a private cache. The local wheel output is recorded with its SHA256 in a private preparation receipt; it is not misrepresented as a published vendor binary. No Matrix instance is installed or started yet.
4. Return to the Matrix panel in Apps & services and review installation. This plan binds the prepared wheel hashes. Apply, then separately Configure and Start. SQLite, media and signing keys belong to that instance's private data/config directories.
5. API availability checks the Matrix versions and login APIs; it does not establish authentication. Registration stays disabled. Explicitly review ordinary/admin local-account bootstrap or authenticate an existing account, then select spaces/rooms. No account or message is created automatically.
6. Stop and restart without replacing the server name, database, signing keys or media. Consistent backups require a stopped instance and retain private archive/hash receipts.

Preparation failure retains verified downloads, partial bytes, compiler/build logs and progress under `cache/matrix/<recipe hash>`. Review preparation again to resume verified inputs; partial files never count as complete. An unavailable preparation is not an installed Matrix instance.

## Ownership and optional network workflows

Each managed instance lives at `<setup root>/instances/<instance ID>` with independent source, configuration, operational data, logs and receipts. The default setup root is `~/Library/Application Support/Zenith/Hub`, outside the source checkout. The preview uses a disposable override. External connections grant no start/stop/upgrade/delete authority. Core remains unchanged; infrastructure projections are observations, not invocability or authorization claims.

Public Matrix TLS/DNS and managed Zenith subdomain reservations are explicit external prerequisites. No DNS account/provider is assumed. VPS mode requires an owner-private target descriptor, strict SSH host keys and a verified matching Linux closure; it must not be presented as a qualified local journey. Tailscale access requires an existing authenticated daemon and a separately reviewed Serve action. No automatic Funnel, public exposure or permission widening.

## Freshness, reviews and recovery

The UI polls read-only health every five seconds, cleans up timers/requests on unmount and refreshes on focus. Health reads do not increment the configuration revision or invalidate reviews. Draft selections, backend edits and active plans are not replaced by polling. Older in-flight responses cannot overwrite a newer mutation. A failed/timed-out check disables actions and retains drafts/reviews; the next successful check recovers freshness.

Plans expire after two minutes and bind the state revision, catalog, adapter/source/lock hashes and verified installer executables. Changes require a new review. Applying long work durably reserves an operation before returning. The request then runs through Next's `after` lifecycle; the browser observes retained progress without holding the installation request open. Controller restart makes unconfirmed ownership explicit, and reconciliation reads retained receipts. It never claims interrupted work succeeded.

Do not infer app readiness, authorization or ontology admission from installation/liveness. Existing v1 deployment/resource readers and data ownership remain intact.

## Apps & services gallery

The gallery shows existing registrations under **Configured instances** and unconfigured catalog offerings under **Available apps**, each with its own count. A configured instance may still be stopped, disconnected or need setup; its status and controls reflect that state. Selecting **Details** opens the existing instance, while **Add** starts the existing guided review/apply flow. To register another instance of an already configured app, select **Add another** in its details.

Hermes is the installed or connected Hermes agent, rather than a separate guide product. The gallery displays older default “Hermes guide” names as “Hermes” while preserving stored records, custom labels, native settings and service identities. Configure Hermes returns to the existing welcome configuration flow. Infrastructure resources such as hosts, storage and networks are distinct from these app/service cards. The API keeps its existing `resources` field and action identifiers for compatibility; this presentation change adds no ontology class or resource graph.

## Generic Matrix setup

[Matrix onboarding, records and recovery](matrix-implementation.md) describes the generic on-page server/account/space/room flow and its exact qualification limits. [Validation results](matrix-validation.json) distinguish disposable protocol/native-file fixtures from live service qualification.

## Process Runtime candidate upgrade

In Settings, open the Hub-managed Process Runtime and select **Review Runtime upgrade**. Review the current and target commits, wheel hashes, database, port, rollback target and production configuration. The first supported transition is from `2efdf96` to local candidate `fbbe560` on Apple silicon macOS. Both artifacts report package version 0.1.0. The Hub distinguishes them by pinned bytes.

Place the reviewed wheels together in `<setup-root>/cache/runtime-upgrades/<full-target-commit>/`, or set the Hub operator's `ZENITH_SETUP_RUNTIME_WHEELHOUSE` to their absolute directory. The [release manifest](../../profiles/setup/process-runtime-upgrade.json) lists the exact filenames and hashes. Missing or changed wheels appear as prerequisites. To use the production profile, provision owner-private `receiver.json`, `admission.json` and `readiness-trust.json` in the instance's `config` directory before review. The upgrade requires closed new-run admission. With the profile absent, the candidate starts with default-deny authority.

Preview while running, then stop the Runtime and review again to apply. Hub stages the new environment separately, checks its dependencies and CLI, backs up the stopped instance, and switches the installer receipt. Start the instance from Settings and inspect its monitoring history. To revert, stop it, review and apply **Review Runtime rollback**, then start it. Rollback reselects the previous software against the same database. The tar backup and its receipt are available under `backups/<instance-id>/` for a separately reviewed data restore. After an interrupted switch, use Hub reconciliation to read the durable receipt before retrying.

Transfer approval is a separate operation. The available connector supports read-only calls to its qualified provider. This software upgrade issues no Runtime command credential.
