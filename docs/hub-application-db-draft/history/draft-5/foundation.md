# Repository foundation — implementation and qualification

Implemented on `codex/hub-repository-foundation`, 2026-11-23, with existing unrelated work preserved. This completes implementation slice 1 under the qualification limits below. The active next steps remain in [implementation-plan.md](implementation-plan.md).

## Activation and compatibility

`ZENITH_HUB_REPOSITORY_FOUNDATION=1` explicitly selects the foundation for the generic `/api/objects` controller. Without it the existing `ObjectStore` path remains unchanged. Existing setup, gallery, configuration, credentials, service health and connections still use their existing owners. Do not point a live multi-consumer deployment at a new foundation root until the later cutover slices migrate those consumers together.

`HubRepository.open({dataDir, registryFile?})` opens a new private root. An empty root initializes the pinned schema-4 database and immutable definitions. An existing schema-2 database opens in `legacy-read-only` mode: reads and exports continue, writes return `repository_migration_required`, no foundation tables are added and no records are downgraded. Unknown database/definition versions fail closed; there is no live migrator in this slice. Keep the same root/binary on restart. The old writer refuses schema 4.

Runtime contracts live in `profiles/application-db/`, separately versioned from review draft 5. The application manifest is SHA256-pinned in `src/lib/objects/application-pin.mjs`; the manifest pins every asset. Package/module/schema/profile/mapping inputs are copied into immutable definition storage and pinned on object versions. Imported data never chooses a loader path. Changing this preview definition set requires a reviewed migration or a fresh qualification root; it is not automatically applied to a previously initialized root. Core/Infrastructure class definitions and the production ontology registry are unchanged. Application predicates declare semantic relationships, not new classes.

## Repository interfaces

- `commitBatch(batch)`: closed internal `commit.schema.json` contract, serialized through one durable SQLite writer, with generation/object/record compare-and-swap and stable idempotency.
- `readSnapshot()`: one captured DB selection, verified immutable files, independently validated profile/RDF values, reference rules, inspection evidence and app projections. It returns observations at their timestamps, not a promise that old presence evidence is still fresh.
- `get(id)` / `getVersion(id, objectRevision)`: current or exact historical JSON-LD/bindings, original reference selectors and definition pins. `GET /api/objects?operation=get&id=<IRI>&revision=1` exposes exact history through the existing envelope.
- `importDocument`, `importBundle`, `exportDocument`, `exportBundle`, `list`, `relationships`, `connected`: compatibility interfaces. Generic, untyped named and blank-only RDF units require no Hub app rows. Import compilation uses a disposable in-memory ObjectStore projection, never another durable database.
- `rebuildIndexes()`: explicitly verifies authoritative files/commit metadata, then rebuilds type/profile/link/software-key caches without advancing semantic or app revisions. Missing/corrupt authority or inconsistent app fields fail closed. There is no automatic GC or authority recovery from a projected label.

Portable bundles retain the existing transport: they do not export the local revision ledger, inspection authority or its local server-issued handles. Cross-repository historical provenance transfer remains part of later migration work. New infrastructure admission is rejected; existing admitted v2 records remain readable/exportable without conversion.

## Stable provenance

| Description | Identity-defining facts | Allowed correction |
|---|---|---|
| SoftwareDescriptor | Stable software identity, independent of release/catalog/install | Descriptive information |
| SoftwareSourceSnapshot | Software association, canonical repository identity, immutable commit | Display version/manifest metadata without changing snapshot facts |
| SoftwareBuild | Software association, ArtifactRef identity/revision + SHA256/length, exact source version when known, applicable platform | Display version/media type without replacing content/provenance/platform |
| SoftwareInstallationRecord | Software + host, exact source/build versions when known; verified copy identity retained in evidence | Location bindings for the same copy, with fresh inspection before a new presence claim |

Source/build fields in RDF identify graph targets; `referenceBindings` select their exact retained object revisions. A newer source/build metadata revision does not change an unchanged installation's pins. Changing repository/commit, build content/source/platform, or installed-version provenance requires a new description identity. An upgrade creates a new installation description. Unknown source/build remains omitted; registration does not mint fictional provenance. Original descriptions and bindings remain readable after upgrades.

Selectors cannot be attached or changed later on an already committed owner revision. Commit manifests retain the selectors and inspection associations, and reads check SQL copies against those committed records. This protects against projection/selector drift, not a malicious privileged rewrite of the entire database and its commit ledger.

## Internal inspection publication

A real inspector is **not installed or enabled by this slice**. Owners/tests may inject `inspectSoftware`, an immutable `inspectionAdapterDigest` and `inspectionHostRef` when opening a repository. The callback supplies read-only inspection facts through a trusted server boundary. It receives exact descriptor/host/installation versions and their reference selectors. It must not execute discovered software, inspect secrets or fabricate source/build records.

```js
const observed = await repository.inspections.inspect({softwareRef, hostRef});
// observed = {inspectionHandle, proof, persisted:false}
const write = repository.inspections.write(observed.inspectionHandle, {
  objectId: newlyAllocatedInstallationId,
  objectRevision: 1,
});
// Include this authorized write in the same batch as the new installation's
// complete object/profile/app writes and exact known provenance selectors.
batch.inspectionWrites.push(write);
await repository.commitBatch(batch);
```

A proof retains exact `softwareVersion`, `hostVersion`, applicable `sourceVersion`/`buildVersion`, known `subject.installationVersion` or server-issued `subject.candidateId`, copy identity, filesystem fingerprint (or honest unavailable reason), scope/completeness, observation/expiry/boot, adapter digest, classification and reasons. Present requires verified copy identity + SHA256; absent requires complete scope. An inspector exception produces unknown, not absent. No placeholder ontology object is created for a candidate.

The facade resolves the opaque handle and issues a write object with private in-process authority. Plain JSON, cloned/altered writes, expired handles, remote hosts and nonexistent object versions cannot publish presence. Handles expire after 30s, are tied to one server boot and are rechecked before publication; committed same-key retries replay rather than issuing new evidence. Registration associates candidate evidence with a new installation in the same commit. Database failure publishes neither. Inspection/provenance mismatches are rejected even when newer target versions exist.

This is a persistence/facade contract, not a native installation qualification. The future inventory/action facade must recheck native fingerprints at action apply and calculate effective freshness; a young persisted observation alone cannot prove files remain unchanged. No new public inspection/review route or software-entry shortcut is enabled here.

## Publication and recovery

Immutable bytes are written with private exclusive no-follow handles, rehashed, synced, renamed on the same local filesystem and directory-synced before SQLite publication. SQLite uses WAL, full synchronous mode, foreign keys and fullfsync. A stale writer can leave harmless orphan files but cannot publish half a generation. The committed idempotency result recovers lost acknowledgements. Current selections, object/binding versions, typed evidence, associations and app views commit together. Staging/orphans/history are retained for later reviewed maintenance.

Initial storage accepts APFS/HFS on macOS and an explicit common-local-filesystem list on Linux; it rejects unsupported filesystem types, symlink roots/representations and cross-device staging. This is conservative configuration validation, not qualification of every storage controller or filesystem.

## Verification record

Run from the repository root:

```sh
npm run test:objects
npm run test:setup
npm run test:hub
npm run typecheck
npm run check:source
node docs/hub-application-db-draft/make-fixtures.mjs
node docs/hub-application-db-draft/generate-diagrams.mjs
node docs/hub-application-db-draft/verify.mjs
node docs/hub-application-db-draft/verify-design.mjs
```

Foundation tests use private owned temporary roots and synthetic software/host facts; they do not read a live database, installed software, credentials or native service state. The [verification record](foundation-validation.json) retains source hashes and exact results: 93 object tests (49 foundation tests), 71 setup/Hub tests, 68 contract probes, 31 design checks, TypeScript/source-pin checks, and the four built API modes below. Coverage includes immutable-identity positive/negative controls, original-version access, generic/bundle/controller compatibility, no-row profile validation, complete shared units, binding-only edits, type/reference drift, candidate/no-placeholder registration, forged/expired proof rejection, unknown inspection, atomic evidence rollback, stale competing writers, cache rebuilding and legacy read-only compatibility. Every file/transaction publication fault hook is exercised. Separate disposable children are SIGKILLed before and after SQLite COMMIT to test actual process-death WAL recovery.

Not qualified: actual power failure, physical disk exhaustion, denied system fsync, volume disconnection, native installation layouts/races, cross-release definition migration, live conversion, backup/restore and complete inventory/onboarding HTTP cutover. Fault-hook exceptions are not evidence of hardware durability. Later slices must qualify these before production cutover.

Production packaging was checked with `next build --webpack` in a disposable source copy, followed by `scripts/check-object-api.mjs` in four modes: default, `--foundation`, `--standalone`, and `--standalone --foundation`. They test real ephemeral HTTP servers and disposable databases. This avoided touching the running Hub’s `.next`/`.next-preview` directories. The test copy linked the checkout’s existing Node dependencies; Next emitted tracing warnings for that external dependency path. A fully relocated dependency bundle and the default Turbopack build were not qualified by this run.
