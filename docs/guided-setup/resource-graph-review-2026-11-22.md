> Historical: the experimental resource graph described below was rolled back on 2026-11-22. It is not the current gallery/API contract. See [the rollback record](resource-gallery-rollback-2026-11-22.md).

# Resource graph implementation review

Date: November 22, 2026 (America/Vancouver).

Review source: local `codex/guided-component-setup` working tree at
`/Volumes/home/bananawalnut/repos/hub-native-sai-demo`. The Hub changes include
uncommitted/untracked work; a reviewer reading remote main will not see this
implementation. Reusable UI source is committed in its own repository; the compact
cards are pinned to `84943ad7cb68b9e56ea95a4c2e5b7c751c2c76d8`. No PR or publication
was created for this review.

## Assessment

The implementation currently maintains a **source-scoped inventory projection**.
It is not yet a complete resource graph with shared identities, dependency
relationships and continuously reconciled lifecycle evidence. Earlier summaries
made its completeness sound stronger than the implemented coverage warrants.

The useful foundations are isolation from unrelated objects, transactional
projection replacement, source/revision checks, preservation of external-service
ownership, and a resource UI that delegates effects to the existing controllers.
The missing pieces are semantic coverage, shared identity and reconciliation
integration. Passing preservation/API tests do not establish those missing pieces.

This pass changes the card presentation and documents the graph implementation.
It does not silently repair/restructure the resource graph, delete stale scopes,
merge identities, alter saved connections or start services.

## Changes made to enable the feature

Paths are relative to the Hub repository unless marked UI library.

| Area | Implemented change | Boundary retained |
|---|---|---|
| `src/lib/objects/projections.mjs` | Generic `ProjectionIndex` with `projection_scopes`, `projection_nodes`, `projection_types` and `projection_links` in the existing SQLite database. Stores a canonical RDF snapshot plus metadata, derived indexes, source revision, observation time and projection revision. Supports atomic replacement, compare-and-swap, stale-source rejection, type filtering and rebuilding. | Does not replace ordinary `objects`, `units`, import receipts or their indexes. Scope replacement cannot overwrite an ordinary object with the same IRI. |
| `src/lib/objects/store.mjs` | Instantiates the projection index. Additive tables; existing schema version and ordinary object operations remain unchanged. | General object storage remains general purpose. |
| `src/lib/objects/controller.mjs` | Adds read-only `projection-scopes` and `projection` operations, with optional type/subclass filtering. | Default list/get/relationships/connected/export/bundle operations still operate on ordinary objects, not the derived projection tables. |
| `src/lib/hub/resource-graph.mjs` | Converts registered setup instances and the configured external registry into typed resource nodes and a small fixed set of relationships. Generates resource/scope IDs and public metadata. | Catalog availability is not asserted as an installed resource. Credential values/file paths are excluded. |
| `src/lib/hub/controller.mjs` | New overview that refreshes those sources, reconciles their scopes and returns resources/catalog/graph/operation summaries. Five-second cache and single-flight refresh. Adds reviewed Add/control/apply/cancel operations. | Native setup and existing connection controllers remain responsible for effects. |
| `src/app/api/hub/route.ts` | Local Hub API with same-origin, numeric-loopback, Host, body-limit and CSRF checks. | No remote administration or new authority grants. |
| `src/lib/setup/objects.mjs` | Replaces the older setup import into ordinary object assertions with a setup-owned scoped projection. | Old ordinary assertions are retained; there is no identity migration or reconciliation with those assertions. |
| `src/lib/setup/controller.mjs` | Completed setup operations call the projector. An additive `set-connection-enabled` operation retains external connection records/configuration when disconnected. | Installing/configuring/starting remain separate reviewed actions. |
| `src/lib/setup/runtime.ts` and setup API | Share the controller construction used by the setup and Hub route integrations. | Existing saved setup shape and drafts stay readable. |
| `src/lib/objects/codec.mjs`, `next.config.ts` | Fix the worker launch path under Next.js and trace worker/ontology assets into production/standalone outputs. | JSON-LD processing stays in the bounded worker. |
| `src/components/hub/YourHubPage.tsx`, `/hub` | Replace the old fixed-stack deployer destination with a resource gallery, details, graph and inline Add/review. Poll every five seconds while visible. | Legacy deployer/workspace routes and their targets are retained. |
| Canonical UI library `src/YourHub/*` | Gallery, graph renderer/layout, detail, inline flow and shared welcome-themed canvas. Navbar/title removed. Latest change removes the icon/management header row and makes cards smaller. | Available catalog entries and registered instances remain distinct in the data. |
| Tests and CI | Add scoped-isolation/replay/restart/stale-writer/resource/API tests and production/standalone Hub HTTP smoke checks. Hook resource checks into the existing CI workflow. | Qualification uses temporary/in-memory data; no real install/start/model download was applied. |
| Documentation/provenance | Add the feature contract, verification record, reproducible review probes and exact UI source commit hashes. | Normalized ontology release files and pins are unchanged. Infrastructure remains an unpublished Hub extension. |

A machine prerequisite was also changed: the user-owned `/Volumes/home` mount
directory was tightened from `0775` to `0755` because the existing private-storage
ancestor guard refused group-write access. Data-file contents and the guard itself
were not changed.

## What is actually indexed

The current graph has two supported input categories:

1. `setup.json` registered `instances`, enriched by the existing adapters' observations.
2. The explicitly configured `ZENITH_HUB_RESOURCES_FILE` registry, which currently
   supports external Devgraph connections.

For each source, the builder can emit:

- A `zn:Collection` inventory root and `infra:hasMember` edges.
- A registered daemon as `infra:ServiceInstance`; Frank's package as `zn:Artifact`.
- A local `infra:Machine`, `infra:Deployment`, and data `zn:Collection` based on the
  registration's local mode/root.
- `infra:hostedBy` and `infra:realizes` edges. A VPS target can identify a remote
  Machine instead of being incorrectly placed on the local host.

There are currently no generated storage-volume, network or dependency edges.
Model/provider choice is metadata; model-server identity, native profile identity
and installed software artifacts are not reconciled as connected resource objects.
The builder does not ingest arbitrary objects already in the general object store.

## Live evidence

At the read-only review snapshot:

| Fact | Observed value |
|---|---|
| Registered resources | 1: the setup-owned Hermes instance |
| Resource graph | 5 nodes / 5 edges |
| Source setup revision | 37 |
| Active projection revision | 3,607 |
| Ordinary object list | 0 objects |
| Retained projection scopes | 2: the original unnamespaced scope and its later namespaced replacement |
| Saved setup projection marker | `pending-reconciliation` |
| Overview source warnings | None |
| External registry API | Disabled (`resources_disabled`) in this preview |

The gallery shows six supported software/resource kinds, but five of those are
catalog choices rather than registered instances. They are intentionally absent
from the instance graph. This distinction should stay explicit rather than
inventing running objects for every available installer.

## Findings that need alignment

### 1. The projection is a separate query surface

Resource assertions live in derived `projection_*` tables. Ordinary object queries
and exports do not include them, and existing objects are not matched/reused.
This protects existing data but leaves two semantic surfaces in one database.
There is no unified query for ordinary and projected resources, no shared
relationship traversal between them, and no portable export of this graph through
the ordinary object-bundle path.

Source: `src/lib/objects/controller.mjs:42–67`, `src/lib/objects/store.mjs:239+`.

**Review decision:** make resource indexing a view over shared object identities
and source-owned assertions, or define explicit federation between these stores.
Keeping ordinary data safe does not require inventing a second identity universe.

### 2. Identity is keyed to registrations, and Hub identity is used as host identity

`machine.json` is generated per setup root, then used both to namespace that Hub's
projections and to identify "This Mac." Two Hub installations on the same host can
therefore create distinct Machine identities. A service ID hashes that machine ID
plus the source/registration key. The same endpoint in setup and the external
registry produces two ServiceInstance IDs.

Source: `src/lib/hub/resource-graph.mjs:14–22,70–93`.

**Review decision:** distinguish the Hub installation's identity from host identity;
reference a service's stable declared identity when available. Keep connection
bindings distinct without automatically declaring a new service for each binding.
An endpoint alone is insufficient proof of either sameness or difference.

### 3. Reconciliation rewrites snapshots on observation timestamps

The digest includes all node metadata, including fresh observation timestamps.
A health refresh can leave every RDF assertion unchanged but increment the
projection revision and rebuild all its derived node/type/link rows. This is a
transactional full-snapshot replacement, not an incremental semantic update.

Source: `src/lib/objects/projections.mjs:46–66`, `src/lib/hub/resource-graph.mjs:58`.

The in-memory probe reproduced revision **1 → 2** at source revision **7**, with
identical graph assertions and only a timestamp change. The live revision disparity
above shows why projection revision is not a useful structural-change indicator.

**Review decision:** separate structural/configuration revision from observations,
freshness and last-check time; update only the affected index/observation state.

### 4. Updates are request-driven and integration markers disagree

The first overview read and visible-page polls refresh the index. Successful setup
execution also projects its source. Other changes are picked up by the next read;
there is no independent watcher, event subscription or durable reconciliation queue.
The saved `objectProjection` marker can remain `pending-reconciliation` after a
successful overview refresh because that refresh does not update the marker. The
live preview had that marker while reporting no source warnings.

Source: `src/components/hub/YourHubPage.tsx:35`,
`src/lib/hub/controller.mjs:26–57`, `src/lib/setup/controller.mjs:390–397`.

**Review decision:** use a coherent synchronization watermark/retry state, with a
clear demand-driven or background maintenance contract. Do not let the UI and
saved setup state disagree about whether reconciliation completed.

### 5. Graph rendering hides health changes and unresolved references

Status lives in node metadata. The SVG renders labels and class names, not status,
readiness or freshness. A service changing from Stopped to Ready can produce the
same diagram. Layout also discards edges whose endpoints are outside the displayed
node set; unresolved references are not shown as such.

Source: UI library `src/YourHub/YourHub.tsx` (`ResourceGraph`) and
`src/YourHub/graph-layout.ts`.

**Review decision:** show current versus stale observations explicitly, and render
unresolved links or an honest omission indicator instead of silently hiding them.

### 6. Some infrastructure facts are inferred too early

A local registration creates a Deployment and a logical data Collection whenever
its fields permit, including partial/uninstalled instances. No filesystem or
installation evidence check gates that construction. The review probe produced
both nodes for an instance explicitly marked `Setup incomplete` and
`installed: false`.

Source: `src/lib/hub/resource-graph.mjs:79–89`.

**Review decision:** distinguish desired/planned configuration from observed
existence and verified placement. A saved path does not itself establish a volume,
persisted collection or successful deployment.

### 7. Important resource relationships are missing

The graph cannot yet answer the earlier examples about model dependencies or
external-drive failure. It has no generated model-server dependency, profile,
software-installation/weight Artifact, physical/logical StorageVolume association,
or resolved service requirement. `modelEndpoint` is retained as configuration but
produces no backend node/edge. Software discovery results are not reconciled into
this graph either.

Source: `src/lib/hub/resource-graph.mjs:40–96` and
`src/lib/hub/controller.mjs:30–51`.

**Review decision:** define a small explicit source-to-object/relationship mapping
for each independently meaningful thing. Reuse existing classes and schema
structures; adding coverage does not mean adding one class per app/configuration.

### 8. Old scopes and restored revisions need lifecycle rules

The live store retains the superseded unnamespaced projection. The overview ignores
it but generic scope queries still expose it. No retirement migration was added.
A restored source with a lower revision is rejected as stale; there is no explicit
restore/reseed policy. Source failure preservation is useful but does not by itself
solve intentional source removal, restore or supersession.

Source: `src/lib/hub/resource-graph.mjs:12–14,98–104`,
`src/lib/objects/projections.mjs:56–58`.

**Review decision:** define safe scope retirement, restore epochs and explicit
removal semantics. Do not delete or merge existing data as an incidental cleanup.

## Verification and its limits

The earlier 188 regression checks, eight UI checks, production build and six
production/standalone HTTP checks passed. They establish isolation, compatibility,
review/apply boundaries and selected snapshot behavior. They do not prove complete
resource coverage, canonical identity reuse, heartbeat/no-op semantics, diagram
status visibility or continuous synchronization across all services.

Focused review evidence is saved in
[resource-graph-review-probes-2026-11-22.json](resource-graph-review-probes-2026-11-22.json).
It uses synthetic records and an in-memory store; it did not change live resources.

## Suggested review order

1. Agree whether the resource graph is a scoped view of the general graph or an
   explicitly federated projection, and define query/export behavior.
2. Settle Hub, host, service and connection-binding identity separately.
3. Define the intended-versus-observed facts and minimum source/relationship coverage
   for Hermes, its backend, one external Devgraph, one managed service and storage.
4. Fix structural revisions versus observations, synchronization watermarks and
   safe recovery/retirement semantics before extending the diagram further.
5. Add semantic scenario tests for those decisions, then expose status/freshness
   and missing-reference handling in the graph UI.

The gallery changes can proceed independently. The graph should be treated as an
implementation to refine, not as the canonical definition of the resource model.

## Brief for an independent reviewer

Review the source and the isolated probe results, rather than treating the UI or
this report as the resource model's authority. Prioritize semantic coherence and
source/identity correctness. Distinguish an underlying resource from its software,
profile, connection binding, deployment, desired state and observed state. Avoid
new classes that merely reproduce application boundaries.

Concentrate on `src/lib/hub/{controller,resource-graph}.mjs`,
`src/lib/objects/{store,projections,controller}.mjs`, the setup projection hook,
the resource renderer/layout, the existing infrastructure module, and the new
Hub/projection tests. Check whether a resource should be queryable together with
other objects, how two source descriptions refer to one service/host, and what a
refresh may safely infer. Consider heartbeat-only updates, offline sources,
partial installation, lower restored revisions and superseded scopes.

Return prioritized findings with source evidence, the smallest coherent repair
plan, and semantic scenario tests that distinguish expected behavior from the
current implementation. The existing preservation tests are useful constraints;
they are not proof that the current conceptual split is correct.
