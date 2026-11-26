# Changelog

## [Unreleased]

### Fixed
- Allow the clean-clone checks to wait for the full owner operation and retain browser evidence before crash testing — hosted receipt verification could outlast the monitoring assertion.
- Retry a timed-out local service readiness read within the startup deadline and identify its owner on failure — one slow first probe could abort the reviewed example installation.
- Detect local APFS and HFS mounts by filesystem name on macOS — boot-specific type numbers caused supported Macs to reject repository initialization.
- Pin the headless Chromium used by the macOS clean-clone job and allow time for the first Settings navigation — the hosted desktop browser repeatedly timed out before the example could run.
- Reconcile Frank’s retained completion after a lost Runtime acknowledgement and correlate its journal with the committed output — retrying must preserve one dispatch and let Hub recover the original receipt.
- Wait for the running Hub to identify its database before printing the Settings link — a user opening the link immediately could otherwise reach a port that was still starting.
- Show the Runtime’s reported storage, authority and admission checks in readiness failure history — an HTTP 503 alone concealed the production readiness blocker.

### Added
- Run and recover a local Case through Service Management, Process Runtime and Frank from Settings — new users can verify a real committed output from one reviewed download with no sibling checkouts or production credentials.
- Bootstrap Hub from a fresh Apple silicon checkout with `npm run setup` and exercise the printed Settings URL in a real browser — first-time users need reproducible launcher defaults and proof that their installation serves the page.
- Review, stage and roll back the pinned Process Runtime candidate from Hub Settings — operators can preserve the earlier environment and recover the selected release after interruption.
- Record service checks and contemporaneous Hub-host CPU, memory and setup-volume usage in local monitoring history — operators can now inspect the failing step after a service recovers.

### Fixed

- Prioritize Matrix joined membership over optional sync, allow slower server reads, and report which read failed — optional discovery failures previously obscured verified accounts and unsuccessful room reads appeared as an unexplained empty list.

- Wait for a cancelled Settings review to retire before allowing another action — prevent its background database update from invalidating a newly reviewed operation.

### Added

- Show Process Runtime and Frank in Work with direct setup links and explicit worker readiness limits — make the existing components discoverable without treating installation as execution readiness.
- Identify installed components that still need configuration — distinguish incomplete setup from a stopped service.
- Separate account-native Matrix direct messages from group rooms and add in-window reviewed DM, room creation/invitation, join and invitation-acceptance flows — both one-to-one and shared conversations should work without leaving the floating chat.

### Fixed
- Batch independent Matrix discovery and account-data reads — slower existing homeservers should not exhaust the floating list’s refresh window through sequential probes.
- Retain unrelated m.direct mappings, reuse verified encrypted DMs and resume a retained room after a mapping failure — partial or uncertain outcomes must not silently create duplicate rooms or invitations.
- Check the actual encrypted-message event permission in encrypted rooms — the composer must respect the homeserver’s permission for the event it sends.

### Added
- Read recent Matrix messages and send from the same floating Messenger-style window, with persistent per-device native encryption, explicit Send and idempotent retry — conversations must stay in the Hub without replacing existing accounts, sessions or room encryption.

### Fixed
- Release idle native crypto workers with their owning Hub process and keep worker launch arguments independent — persistent encryption must not prevent clean server stops or inherit parent evaluation flags.
- Chain exact main-Hub and Matrix follow-up source pins to the retained database review ledgers — historical evidence must remain reproducible while approved UI changes pass design verification.
- Exclude floating Matrix conversation text from Hermes page-context capture — decrypted private messages must not enter the separately approved general-page context bridge.

### Changed
- Give the floating Matrix panel compact Messenger-inspired blue chrome, an account card and a light room list — the previous wide dark surface obscured the contact-window character and room hierarchy.

### Changed
- Replace the floating HUD options with a rebuilt radial collar, a dedicated inbox segment and profile dots on the curved rail — the menu should behave and read as one compact control with stable hover and keyboard navigation.

### Changed
- Use a fine HUD arc with colored Hermes receiver dots and a small Matrix inbox glyph, retaining hover previews and click-to-pin — the control should remain minimal while selecting real configured receivers without changing their saved setup.


### Changed
- Show Matrix spaces in a horizontal carousel above the selected space’s room list — the floating chat should group rooms by their actual space relationships.


### Fixed
- Distinguish an incomplete Matrix account check from a verified identity mismatch — an unavailable homeserver must not imply that the saved account changed or expose unverified rooms.
- Preserve the HUD dot independently of Hermes readiness and open floating Matrix rooms/spaces from its hover dial — the chat surface belongs to Matrix while the original Hermes input remains separate.

### Removed
- Revert the mistakenly added Hermes transcript and follow-up-history API — switching the HUD to Matrix must not change agent conversations or introduce an unrelated chat protocol.


### Changed
- Remove Conversations and Matrix polling from the main Hub, keeping room/account controls in Settings — chat should open from the existing Hermes input rather than occupy a separate workspace area.

### Added
- Add a hover/focus dial for Quick and Chat modes, retaining chat exchanges and bounded follow-up context — users can turn the same glass control into a conversation without changing services, credentials or stored configuration.


### Added
- Add the main Hub workspace with verified Matrix conversations, work-service summaries and direct configuration prompts — Continue now opens everyday activity while installation and account controls stay in Settings.

### Changed
- Use client-side Hub/Settings navigation with one global Hermes input and an in-memory conversation selection — moving between work and configuration must preserve chat state and existing setup, connections and data.


### Changed
- Make the existing gallery Settings & configuration at /settings, retain /hub as a compatibility view and direct Matrix configuration links to settings — setup needs a clear home while the main Hub screen is planned, with all existing instance and session bindings retained.

### Added
- Document the proposed main Hub screen after Continue, including navigation, real-data ownership, conversation limitations and a staged implementation — the everyday workspace should be reviewed before replacing the working configuration surface.

### Added
- Add generic reviewed Matrix account, space, room, membership, permission and explicit message-verification setup — users need a resumable product journey without application-specific templates or duplicating the homeserver database.
- Persist opaque Matrix session bindings, retained reviews and partial outcomes in the existing application owner — reload/restart must preserve progress while passwords and tokens stay out of repository objects and review artifacts.

### Fixed
- Distinguish Matrix API availability from authenticated accounts across gallery and Communications, normalize safe root URLs, and derive default discovery ports from the catalog — a public API probe must not imply sign-in or omit the managed port.
- Recover owned Synapse configuration without regenerating keys or redirecting retained data, provide explicit reviewed legacy-identity reconciliation, and map wheel receipts to exact build/installation versions — retries and later metadata changes must preserve server identity, accounts and original provenance.


### Fixed
- Make Inkling job fixtures specify supported and unsupported hardware and assert the actual qualification failure — Linux CI must test context/inference handling without accidentally failing every path at the platform guard.

### Fixed
- Run all JavaScript and Python suites plus packaged API, migration and design checks in CI, with pinned HTTP test dependencies and separate exact follow-up ledgers for historical snapshots — release qualification must cover the current provider bridge and database launch paths without weakening original provenance checks.

### Added
- Publish the Hub database ownership, migration/recovery and onboarding specifications with retained historical review fixtures and an exact follow-up pin ledger — reviewers need to distinguish current behavior, earlier design evidence and intentionally changed inputs.

### Changed
- Connect database-first launch, default Hermes model configuration and the Apps & services gallery through the existing reviewed APIs — onboarding must recognize installed software and retain setup, connections and native data without requiring a guide profile.

### Added
- Add the single-writer object repository, application persistence, pinned software catalog and native inspection contracts — Hub records must resolve to committed object revisions while preserving legacy readers and source/build provenance.

### Changed
- Rename the gallery to Apps & services, separate configured instances from available apps, and display Hermes without the former guide label — software offerings and operational instances need clear, independent counts while existing setup, connections, identities and native data remain intact.

### Fixed
- Inspect fresh Hermes installer receipts directly and retain their verified installation binding across setup observations — Continue must recognize the installed software without depending on the retired guide/profile receipt shape.

### Changed
- Open Hermes Configure directly on its default provider/model settings and bind detected software without creating named profiles — onboarding should connect inference before introducing profile management.

### Fixed
- Merge Hub API settings through native Hermes configuration and use one retained configuration home for setup, authentication and the gateway — changing the default provider must preserve unrelated settings, credentials and history.

### Fixed
- Reject catalog object-ID collisions and require attached qualified recipes to cover each advertised entry mode; prefer qualified automatic matches without overriding explicit choices — independently authored objects must not merge, and onboarding must not offer an unavailable operation.
- Preserve last-good catalog content on failed updates, reject local divergence and reused versions, retain retired installation controls and bind reviews to exact recipe/software/source/package pins — content updates must not overwrite local work, silently change reviewed actions or erase retained resources.
- Preserve bounded operator error codes/statuses across Next module realms — a repository validation rejection must remain an actionable 4xx instead of becoming an unexpected 503.
- Share the process-local setup controller and local operator CSRF sessions across Next route bundles — inventory, inspection and setup actions must use the same CSRF session and busy state in development as well as production.

### Added
- Record live onboarding qualification after the catalog validation fixes — verified no-op startup, preserved guide settings and object history distinguish the running behavior from fixture-only results.
- Record the authorized live database/catalog launcher restart, verified backup and real onboarding entry — the review now distinguishes fixture coverage from confirmed preservation of the existing Hub environment.
- Add a versioned bundled CSV/JSON-LD software and recipe catalog using the existing repository transaction and startup readiness path — content can update fresh or initialized Hub databases without duplicating software identities or installation execution.
- Initialize and validate the Hub application database before UI startup through a local CLI, with readiness, inventory and bounded inspection endpoints — onboarding now uses committed object-backed records instead of independent setup stores.
- Add source-fingerprinted migration plans, verified SQLite/metadata backups, staged round-trip checks and recoverable cutover journals — existing setup, connections, object revisions and native data can be preserved without silent conversion or competing writers.

### Changed
- Route setup, gallery, connection and generic-object controllers through the shared repository; retain reviews across restart and bind operations to exact plan Artifacts — semantic fields have one authority and stale reviews cannot apply after unrelated changes.
- Keep native credentials, histories, installed software and external service ownership in place while seeding stable software descriptors and the built-in index — database startup does not imply installation, guide configuration or process adoption.

### Added
- Add an opt-in single-writer Hub repository with immutable JSON-LD/bindings/definition files, validated projections, retained versions, replay-safe commits and rebuildable RDF indexes — application rows can be checked against the specific stored revision they represent without replacing existing setup owners.
- Add typed server-authorized inspection writes and atomic candidate-registration associations — inspection evidence can be persisted without fabricated presence claims or placeholder ontology objects.

### Fixed
- Pin installation/build provenance to exact source/build revisions and enforce snapshot/build/installed-version identity facts — newer current metadata cannot silently reinterpret an unchanged installation, while descriptive corrections retain original history.
- Keep existing v2 stores read-only when the foundation is explicitly selected and preserve the legacy default — repository qualification cannot silently migrate live Hub data or connections.

### Fixed
- Validate stored profiles independently of application rows, seal complete RDF unit membership/digests and distinguish current from historical references in review draft 4 — removing a row, mixing unit documents or loading history must not bypass semantic integrity.
- Strengthen the Hub database review contract with typed reference resolution, compatible current atomic-unit selections and explicit rejection of unsupported infrastructure admission — the independent audit showed that earlier fixture checks could accept dangling references and mixed historical views.

### Changed
- Generate draft-4 logical and physical database diagrams from resolved schema types and in-memory design DDL — opaque handles, IRIs, composition, inheritance and storage references must remain distinct.
- Record user confirmation of RDF-queryable semantic links and one installed version per installation record — these review decisions are settled and no longer provisional defaults.
- Make declared software/host/source/build/configuration relationships RDF-owned and regenerate the review diagrams from the model — semantic links must be queryable without confusing implementation sidecars with ontology facts.

### Changed
- Revise the Hub database proposal around revision-bound validated object views, stable software descriptors, separate source/build records and composed configuration profiles — matching IDs and file hashes alone cannot prevent semantic drift between application rows, RDF and stored profile values.

### Added
- Specify the single-SQLite Hub database, repository/API contracts, safe presence evidence, durable file publication/recovery and migration/cutover plan — implementation can begin with explicit authority, identity and acceptance criteria rather than inferring them from passing fixtures.
- Draft the core Hub application record model with mandatory stored JSON-LD references and pinned ontology/schema definitions, plus synthetic integrity checks — installation, profile and service records can be reviewed against explicit ontology identities before database migration.

### Removed
- Roll back the experimental resource projection index, reconciliation writes, graph API and graph view while keeping the gallery — resource browsing now reads the existing setup and connection owners directly without persisting a second inventory.

### Changed
- Remove the global Add resource button and replace Refresh text with an accessible icon — the gallery cards remain the entry points for adding resources.

### Added
- Record a source-based resource-graph review and isolated reproduction evidence — reviewers can distinguish the implemented inventory projection from missing identity, dependency and synchronization behavior.


### Changed
- Make the welcome-themed resource gallery denser and remove the icon/management header row from each card — resources can be scanned without large decorative tiles.


### Changed
- Remove the gallery navbar and visible page title and carry over the welcome cloud scene, white/blue controls and glass guide contrast — Continue now opens a consistent resource canvas without extra navigation chrome.


### Added
- Add a read-only resource overview and reviewed Add/control API — the post-Continue experience uses existing registrations and preserves setup drafts, external connections and service ownership.
- Show registered and available resources in an on-page gallery with inline configuration/review — people can add one resource at a time while keeping their environment visible.

### Fixed
- Launch the bounded JSON-LD worker from its owned source path and trace it into standalone outputs — the general object API can process JSON-LD without a bundler-rewritten worker URL failing.


### Added
- Add optional experimental Inkling inference with immutable Unsloth weight/runtime pins, attribution and an instance-only engine upgrade — Hermes can use the new architecture without replacing global software or changing defaults.
- Gate managed Inkling on memory, disk, engine/layout compatibility, hashes and actual 65,536-token context; retain selection only after inference readiness — file size and advertised context cannot establish a working configuration.
- Verify existing Inkling servers through authenticated discovery, live context and a reviewed synthetic probe — incompatible builds cannot silently become the Hub guide backend.


### Changed
- Append approved visible Hub page context to Hermes messages at send time, excluding chat, text-entry values and sign-in content — the guide can answer about the current page while keeping its MVP bridge explicit.
- Record the MVP page-context bridge and future general secS input boundary inline — the temporary Hermes prompt approach remains distinct from reusable agent and non-agent inputs.
- Keep Hermes loading feedback on the input as an animated border and hide the empty response panel — waiting no longer produces a separate text card over the background.
- Replace the floating guide transcript with a heading-free glass latest-reply panel that fades after reading time at 80 words per minute — responses stay readable without permanently covering the welcome scene.
- Start the Hermes guide as an icon-free glass dot and use its leading dot to minimize the expanded glass input — welcome stays uncluttered while preserving the draft and the landing site's glass treatment.
- Keep welcome actions on the cloud background and open expanded install/configuration in one modal, carrying the existing guide into its interaction layer — the page no longer switches to a white card or disables the sole composer during setup.
- Restore the branded Enter/Configure screen after Hermes installation and make the floating pill a direct message field — entering the Hub no longer requires a test chat or duplicate chat-launch buttons.
- Restore the cloud-themed square white-and-blue welcome buttons from the canonical UI library — keeps the installation and guide-profile flow consistent with the chosen pixel-art background.
- Detect installed Hermes independently of Hub configuration and create a dedicated native hub-guide profile using existing software — returning owners can configure the guide without a redundant reinstall, and saved model choices do not silently copy credentials or history.
- Fetch Hermes from the official NousResearch repository at a recorded upstream revision, verified against its archive and file inventory — removes the fork origin from welcome installation.
- Replan Hermes onboarding as installation, configuration and first chat on one welcome canvas — replaces the previous page-based journey and gives the rebuild concrete readiness and recovery criteria.
- Draft onboarding as a pinned-source Hermes prerequisite, separate configuration and subsequent Hub setup — the walkthrough now has an explicit sequence to review instead of treating installation and model readiness as one state.
- Load a connected provider’s models automatically, suggest Hermes’s native default in the draft, and collapse approved sign-in details — account connection now leads to a clear model choice without requiring users to invent a model ID or silently changing the running backend.
- Use only the Hermes provider dropdown — removes redundant brand shortcut buttons from model configuration.
- Make Continue primary and offer secondary on-page Hermes configuration with existing reviewed actions — installed users can advance directly or adjust settings without leaving the landing page.
- Use the original Castalia cloud reveal behind the Hermes action — guided setup now carries the selected blue Zenith artwork through to the installed Hub.

### Fixed
- Refresh only an attested idle model adapter after code changes, refusing active downloads and inference runtimes — onboarding model browsing recovers without restarting Hermes or replacing a running server.
- Ignore cancelled startup checks, replace them immediately on remount and expose controller errors with retry on welcome — development-mode startup can recover without falsely reporting setup unavailable.
- Allow an explicit Webpack development server — the guided walkthrough can use stable hot reload while retaining the production bundler and build output.
- Reconcile communications discovery with saved endpoints and pending selections, including custom local ports — connected services show their live status and cannot be selected again as duplicate connections.
- Keep repeated managed-process observations read-only — Hermes configuration can distinguish running and stopped instances without a reused status log turning successful checks into unknown state.
- Prepare Matrix from pinned published downloads and locked source builds, preflight installer Python/SDK/storage, retain resumable operation progress and refresh setup without replacing drafts — first-run setup no longer depends on an undeclared developer wheelhouse or disables itself while a user edits.
- Keep preview output separate from production builds and avoid re-entering subprocess waits during shutdown — packaging cannot delete an active preview and managed services can stop gracefully with their data intact.

### Added
- Render an authored SVG Zenith cloud scene with slow independent peripheral drift and pause states — welcome can animate without a bitmap dependency, moving the logo or interfering with setup and guide use.
- Record a static-first cloud-background recreation plan with renderer tradeoffs and visual acceptance criteria — preserves the chosen artwork before introducing motion or replacing its bitmap.
- Collapse the floating Hermes input into a circular launcher and restore its draft when reopened — keeps the guide available while freeing screen space.
- Implement source installation, progressive model setup, authenticated startup and first-chat completion on the welcome canvas — owners can finish Hermes setup without using the older wizard.
- Prepare a release-pinned bootstrap runtime when no installer Python is supplied — a clean supported Mac can install Hermes without a Homebrew prerequisite.
- Mount a floating Hermes guide in the global Hub layout after configuration — chat is available on welcome and all Hub pages without restarting the conversation at each setup step.
- Add a pinned Qwen3.5 397B-A17B preset for 512 GB Macs and verify every split GGUF at Hermes’s download destination — high-memory machines can select a flagship model while smaller machines remain protected by native fit checks.
- Expose Hermes-native provider credentials, sign-in and model catalogs plus three hardware-checked open-model presets, reviewed local provisioning and existing-server connections — onboarding can choose a backend without assuming a preconfigured model server or copying personal accounts.
- Open guided setup on a Hermes landing page that follows the local installation receipt — users can review a Hermes-only install or configure the existing instance without selecting unrelated services.
- Introduce an opt-in guided setup and component catalog with reviewed per-instance actions, Matrix lifecycle qualification and a pinned Hermes installer — setup can disclose independent service choices and data ownership while retaining the released onboarding for existing users.

### Added
- Add the Hub-owned Infrastructure extension, verified offline module closure, inherited admission profiles, portable bundles and optional subclass queries — environment records can share normalized Core semantics without duplicating classes or adopting service databases.

### Fixed
- Preserve empty RDF datasets as no-op imports and reject conflicting schema identities or inapplicable CLI flags — valid exports remain reimportable without ambiguous validation or silently ignored owner intent.


### Fixed
- Check object mutation origin and CSRF before reading the body, and accept explicitly pinned context assets independently of their filename — rejected requests remain inert and registered packages can keep their own resource layouts.


### Added
- Add an opt-in Hub-owned SQLite JSON-LD object store with pinned ontology/schema resources, revision-checked transactions and owner import/export interfaces — local object relationships can persist without adopting provider databases or creating duplicate ontology classes.
- Verify semantic import/export across persistent restart and a fresh store with RDFC-1.0 — context, ordering and blank-node representation changes cannot silently change the RDF dataset.


### Changed
- Prepare the pinned normalized Mac installer only after reviewed install apply — opening the released Hub now starts genuine onboarding without an external stack bootstrap or stale component pins.


### Fixed

- Allow an explicitly bounded reader timeout for native storage — prevents healthy persistent hosts being reported unavailable during slower canonical readiness checks.

- Supply the canonical idempotency header in the read-authority denial check and compare credential digests across restart — tests authorization and persistence rather than an incomplete HTTP request.

- Clear initializer supplementary groups before provisioning the API credential and write an explicit newline for database auth — keeps generated secret metadata and process identity consistent.

- Resolve the packaged Devgraph ontology inspector by its canonical module and exclude generated Python bytecode — keeps the container profile portable and its source review clean.

- Create the optional static-assets directory before copying the standalone image — supports the Hub source tree when it contains no `public` files.

- Supply Node’s Linux C++ runtime in the Python-based container and label the Docker profile accurately — prevents startup failure and misleading Mac instructions.

- Update Next.js to the patched 16.4.6 release — clears the existing moderate cache-isolation advisories before adding a deployable container.

### Added

- Register existing Devgraph APIs as external Hub resources with private credential references, cached health and connect/disconnect controls — reuses independently running instances without making Hub own their processes.
- Let organization readers reload the same registered resource binding — connection selection and disabling stay consistent across Hub and the consuming application.

- Publish a native demo source manifest with exact component commits — lets organization demos bootstrap from a clean Hub release instead of borrowing developer checkouts.

- Support an explicitly selected native demo profile on isolated Service/Runtime ports — launches the same Hub health surface without a Docker build or changes to existing Mac installations.

- Qualify the reusable Hub read adapter against the persistent Devgraph API — verifies the same server-side connection code used by private organization demos.

- Separate the Devgraph API and database networks, with no network on credential initialization — gives Hub a narrow API connection without publishing Bolt or sharing database credentials.

- Add an isolated persistent Devgraph Docker profile with independent volumes, owner-private read credentials and canonical migrations — supports a separate organization instance without replacing the personal Mac host or widening Work authority.

- Add an isolated Docker development profile on the merged Service and Runtime sources with normalized Zenith imports — enables a reproducible Lightweight Hub demo without changing native launchers or live data.


- Allow the provider projection to bootstrap with active Service read authority
  and no Runtime authority, then select the exact Runtime query tuple only after
  a request yields its handoff and Run IDs.

### Fixed

- Permit only the exact signed 26-wheel provider predecessor during the
  pre-mutation software-upgrade check — the released workspace can advance to
  the 29-wheel verifier closure while fresh and completed bundles stay strict.

- Keep build-provenance prose out of the closed runtime profile and assert the
  checked-in profile through the bundle validator — prevents valid provenance
  metadata from becoming an unsupported installer field.

- Add the pinned Castalia verifier and its Apple-silicon dependency closure to
  `workspace-provider-v1`, and permit the verified 26-wheel provider release to
  upgrade to it — local Queue admission can now authenticate membership evidence.

- Repin the provider workspace to Service Management's deployment-validated
  provider catalog route — the local Anima client can verify the production
  HTTPS gateway before enabling encrypted submission.

- Reconcile Frank's Wallet executable pin during verified provider-profile upgrades while retaining the prior configuration as recovery evidence — upgraded workspaces can pass readiness and renew native authority without accepting stale executable bytes.

- Added an independently pinned one-item reference Queue pull to the Mac provider controller, so encrypted reference objects can reach the same durable local inbox without reusing the request topic or consumer group.
- Added the complete pinned Vercel Queue 0.9.2 wheel closure to `workspace-provider-v1`; provider pull can no longer pass bundle verification while omitting the SDK or one of its transitive dependencies.
- Pinned the complete `workspace-provider-v1` Mac bundle closure to the reviewed Service Management, Process Runtime, Frank, Castalia Wallet and secS provider heads. The profile now includes the intake opener plus connector-result setup/attestation binaries, and the supported software upgrade recognizes an explicit full-provider transition while retaining prior software and workspace data.

### Fixed

- Repin the required provider Queue bundle to the source head whose public CI
  installs and exercises the same Queue and Castalia dependencies as the release.
- Repin the provider workspace to Service Management's per-request runtime OIDC binding and current seven-day Vercel Queue limit — prevents stale build-token capture and keeps the required offline mailbox on the documented API range.
- Allow an exact numeric-loopback HTTP browser origin in the local provider
  projection while retaining HTTPS for every non-loopback origin, and repin the
  workspace bundle to the corresponding Service Management wheel.
- Refresh the tracked `process_mac.py` source-integrity digest after provider projection supervision changed its reviewed bytes — restores the public source gate without changing the controller or its runtime behavior.

### Added

- Exact stopped-workspace plans for finite provider Service authority and one-handoff/one-Actor/one-derived-Run Runtime authority — closes the source composition gap without enabling a provider, changing custody identity, or accepting browser-selected policy.

- One-item provider admission and brand-package lifecycle actions with fixed stores, native executable/configuration pins, reviewed requester-policy bytes and an exact process compilation — composes local work without adding a scheduler or remote queue.

- One-item encrypted Queue pull composition using an optional release-pinned secS opener, a reviewed closed route, and an owner-private OIDC token file kept out of argv, environment and browser state.
- Read-only deterministic activation preview, reviewed Runtime admission open/close transitions, and exact one-handoff delivery composition for the first provider path.
- Review-pinned automated Frank and human approval operations for the one selected
  brand-package Run, with explicit Actor authority rotation and exact unknown-
  outcome recovery identities.

- Fixed local review pilot actions with pinned configuration and persistent cleanup holds — makes reviewed operator actions visible without enabling an unqualified native bundle.

### Added
- Sanitized lightweight Mac deployer baseline — provide one local setup and monitoring surface while preserving private histories and official Hub configuration.
