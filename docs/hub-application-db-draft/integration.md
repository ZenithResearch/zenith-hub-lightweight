# Application database integration

The local launcher prepares and validates the Hub database **before** starting the web server. Setup, profiles, service descriptions, saved connections, reviewed changes, operations and ordinary stored objects use the same repository owner. SQLite is embedded; it needs no separate database service.

This extends the repository foundation. It preserves the existing setup/gallery API envelopes and their controls. Core and Infrastructure ontology definitions, native application stores and the current UI component implementations are unchanged.

## Start and inspect

Run these commands from the Hub checkout with Node 24 or later:

```sh
npm run hub -- prepare --setup-dir /absolute/private/hub-root
npm run hub -- serve --setup-dir /absolute/private/hub-root --port 4318 --dev
```

`prepare` initializes an empty private root, seeds the built-in software index and local Host description, and verifies the committed state. It does not install software, create a guide, download models or start other services. `serve` does the same checks before launching Next. Open the printed URL only after the server reports readiness. `npm run dev`, `npm run operator`, `npm start` and `npm run operator:start` use this launcher; production commands require an existing Next build.

```sh
npm run hub -- status --setup-dir /absolute/private/hub-root
npm run hub -- inventory --setup-dir /absolute/private/hub-root
npm run hub -- stop --setup-dir /absolute/private/hub-root
```

The process-local setup owner is shared across route bundles so setup, inventory and inspection use the same session and busy state. Gallery, object and connection CSRF sessions are scoped to the operator process/root, so lazy development compilation cannot invalidate a token between GET and POST. Restart the CLI after changing backend controller code during development; foreground UI code still hot-reloads.

`stop` targets only the process whose identity matches this root's private server lease. It does not stop Hermes, Devgraph, Matrix or any connected service. `/api/database` reports the same validated repository identity, generation and schema version through the local operator boundary.

## Migrate an existing Hub explicitly

Existing metadata never silently becomes an initialized database during a read or startup. The launcher refuses an unreviewed conversion. First generate a private plan:

```sh
npm run hub -- db plan --setup-dir /absolute/private/hub-root --plan /absolute/private/hub-root/database-plan.json
```

Review the public summary, source fingerprints, object/unit counts and blockers. The saved plan contains private native bindings and must remain private. Stop the old Hub writer before applying; leave its services and their data running in place. Pass the same `--data-dir` and `--resources-file` when reviewing nondefault locations.

```sh
npm run hub -- db apply --setup-dir /absolute/private/hub-root --plan /absolute/private/hub-root/database-plan.json
npm run hub -- serve --setup-dir /absolute/private/hub-root --port 4318 --dev
```

`serve --migrate` is an explicit combined conversion-and-launch option; the separate plan/apply sequence gives a reviewable migration first.

Migration does the following:

1. Fingerprints saved setup, configured connections, machine identity and both legacy object roots. Conflicting subjects, unsupported store versions and in-progress native operations block conversion.
2. Takes a consistent SQLite backup and private metadata copies. Verifies their bytes and logical source contents. It does not read/copy credential contents, native profiles, sessions or histories.
3. Builds and validates a staged repository, checking setup/connection round trips before publishing. Retains current object revisions, IRIs, complete blank-node units, source import provenance and admitted objects. It invents no earlier history or source/build provenance.
4. Keeps the previous object directory under a `.legacy-<digest>` name, publishes the validated target, and records `application.json`. Owned setup/resources JSON files become redirects that old writers reject. A registry owned outside the setup root stays untouched; this Hub uses its imported database view thereafter.
5. Retains a private journal and backup manifest. No automatic deletion or garbage collection runs.

An interrupted conversion prevents ordinary startup. Recover the same reviewed operation:

```sh
npm run hub -- db recover --setup-dir /absolute/private/hub-root
```

Recovery rolls forward from the retained plan, staged store and verified backups. Before any new database writes, restoring a matching backup is possible while all Hub writers are stopped. After new commits, restoring only the old setup JSON would discard work and create split ownership; preserve the new database, journal and backups and recover it instead.

## Data ownership

| Data | Authoritative owner |
|---|---|
| Semantic labels and software/host/source/build/profile/service relationships | Exact immutable JSON-LD object revision, with trusted ontology definitions |
| Paths, model settings and other declared profile fields | Exact versioned profile bindings validated with that JSON-LD revision |
| Repeated ontology-backed database columns | Validated projections of those object revisions |
| Setup selection, adapter state, opaque credential handles, native receipts and operation bookkeeping | Private application documents / operational tables in the same SQLite commit |
| Full retained review payload | Private versioned document; a `zn:Artifact` profile records its digest, with an exact reference from the operation |
| Credentials, native application data and process ownership | Existing native/external owners, unchanged |

The general object repository remains available for objects with no dedicated Hub table. SQL record names and private document kinds introduce no ontology classes. Ordinary API object edits regenerate mapped application fields; writing a plausible database label alone cannot override the object. Historical object/profile versions remain accessible.

A stable SoftwareDescriptor identifies Hermes independently of any source snapshot, build, installed copy, profile or service. Installation provenance pins exact object versions. Migration records unverified presence as **unknown**, preserving existing ownership; it does not turn an old receipt or a running guide into proof of local software presence.

## Inspection and entry

```sh
npm run hub -- inspect --software hermes --setup-dir /absolute/private/hub-root
npm run hub -- inspect --software hermes --register --setup-dir /absolute/private/hub-root
```

Inspection reads bounded, known installation metadata and pinned source/runtime files. It never executes an untrusted launcher or contacts a model provider. Registration requires a server-issued handle, verifies the filesystem again and commits the association with the installation description. The welcome completion action requires a fresh verified local Hermes copy; it does not require a model, guide profile or running API. Profile configuration and service health remain separate checks.

`GET /api/hub/inventory` reads committed inventory without discovery. `POST /api/hub/inspections` uses the closed InspectionRequest contract. `POST /api/hub/inventory` accepts only `register-existing` and an opaque inspection handle. Existing setup/gallery reviews remain the active mutation interfaces; the broader proposed v2 generic review API is not an implemented endpoint.

## Supported scope and qualification

The converter supports the existing legacy **v2** object store and empty roots. The unpublished foundation-only v4 experiment is rejected with `migration_source_version_unsupported`; no destructive fallback is attempted. New repositories use SQLite `user_version=5` with pinned definition bytes. Cross-release definition changes require their own explicit migration.

Synthetic tests cover normalized mapping, persistence/reopen, stale plans, private-document corruption, read-only legacy admission, complete RDF units, external registry preservation, explicit source changes and five cutover interruption phases. Foundation tests also exercise abrupt process death before/after SQLite publication. Production/standalone HTTP checks use fixture services and credentials. Actual native layouts, machine cutover and exact test results are recorded in `integration-validation.json`; synthetic tests do not establish arbitrary native-layout, actual power-loss, disk-full or mount-disconnect qualification.

## Bundled catalog content

[The catalog guide](catalog.md) describes the additive file package, startup synchronization, exact review pins and retirement/conflict behavior. It reuses this database owner and repository commit protocol. Initialized roots import content through the launcher without replacing their storage or base definition set. Remote retrieval and live rollout are separate qualifications.

## Publication qualification

The original `integration-inputs.json` snapshot is retained. Later approved default-provider, installation-entry and Apps & services changes are recorded separately in `publication-inputs.json`, with previous/current file hashes, reasons and evidence. The design verifier checks that ledger against the original snapshot and exact current bytes; other inputs and all published ontology files retain their existing checks. This distinguishes authorized follow-up work from accidental source drift without rewriting the original integration baseline.

The subsequent main Hub, Settings, radial HUD and embedded Matrix conversation work is pinned separately in `workspace-inputs.json`, chained to the unchanged Matrix follow-up ledger. Exact previous/current digests and verification evidence are required; neither historical input snapshot nor published ontology pins are rewritten.

`process-inputs.json` extends the workspace ledger for monitoring history, Runtime upgrades, and the clean-clone process example. Shared entries apply to both database reviews. Entries specific to one baseline name only files tracked by that review. Each entry pins the previous and new file contents and lists supporting evidence.
