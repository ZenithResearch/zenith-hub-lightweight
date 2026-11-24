> Historical: the experimental resource graph described below was rolled back on 2026-11-22. It is not the current gallery/API contract. See [the rollback record](resource-gallery-rollback-2026-11-22.md).

# Resource graph and Your Hub

## Scope and ownership

The object store remains a general JSON-LD store. Resource indexing is a derived,
observational projection in that same SQLite database, not a replacement for
ordinary objects, imports, ontology packages, bundles or domain records.

`ProjectionIndex` is a general-purpose facility. Its additive `projection_*`
tables are independent of `objects`, `units`, their indexes and import receipts.
Replacing a projection cannot replace an ordinary object, even with the same IRI.
One projection cannot delete another projection's assertions. Existing object
queries/exports keep their previous meaning. No existing data is migrated.

Hub resource scopes are namespaced by the retained Hub machine identity and by
source (`setup` versus the explicitly configured external connection registry).
Two Hub setups can therefore index resources into one general object store.
Projection metadata contains a public allowlist of fields; tokens, credential
file paths, OAuth grants, native profile contents and conversation data are not
copied into the resource graph.

Setup continues to own `setup.json`, selections, instance configuration and its
operation journal. The existing external resource registry remains opt-in through
`ZENITH_HUB_RESOURCES_FILE` and retains its own revisions and credentials. The Hub
does not scan other installations and silently adopt their connections. No service
start, installation, data adoption, model download or domain-record mutation occurs
when the gallery or graph is opened.

## Maintaining the index

- The first Hub overview request after startup reconciles configured sources.
- While the page is visible, it polls the overview every five seconds. The server
  coalesces requests and retains a five-second cache. It refreshes existing setup
  observations using the existing adapters; it does not run inference.
- Completed setup operations project their registrations through the same scoped
  projection mechanism. The next overview reconciles configuration, health and
  connection-registry changes made through other clients.
- A source snapshot is replaced transactionally. Its source revision, observation
  time and projection revision prevent older snapshots or competing writers from
  overwriting a newer result. Identical input is a no-op.
- When a source cannot be read, the last indexed registrations remain visible,
  explicitly unverified and without lifecycle actions. Missing/unavailable sources
  do not become an empty successful inventory.
- Disconnect retains a resource and its configuration. An authoritative removal
  removes only that source's projection assertions on the next successful snapshot.
  Ordinary objects and external services remain untouched.
- `ProjectionIndex.rebuild(scope)` reconstructs projection indexes from the retained
  canonical snapshot. Existing `ObjectStore.rebuildIndexes()` still reconstructs
  the ordinary object indexes independently.

This is observation-based reconciliation, not an always-running service monitor.
When the Hub is closed, stored health is historical evidence, not a live guarantee.

## Semantic mapping

The pinned normalized Zenith release remains unchanged. The Hub infrastructure
extension is still proposed/unpublished. Service instances use its existing
ServiceInstance type; hosts, placements and logical data collections remain distinct.
Remote VPS records are never assigned to the local host. Frank's installed
executor package is represented as an Artifact, not an invented running daemon.
No new Resource superclass or application-context subclasses were introduced.
Endpoints and model/provider choices remain binding/configuration fields.
External services with unknown hosts are left unresolved. Observed Entity types
prove neither invocation conformance nor management authority.

The graph covers registered resources. Available catalog entries are shown in the
gallery but are not asserted to exist as installed/running resources. SAI and other
service-owned domain records are not copied into this inventory.

## API

`GET /api/hub` returns `zenith.hub-overview.v1`: registered resources, catalog,
resource-only graph, independent source warnings, current setup revision and
retained operation summaries. It does not use the older fixed-stack deployer.

`POST /api/hub` uses `zenith.hub-action.v1` and the same numeric-loopback,
same-origin/Host and CSRF boundaries as existing local operations:

- `refresh`, `discover`, `reconcile-setup`
- `plan-add` with a catalog component, new instance ID, supported mode, configuration
  and expected setup revision; optional `prepareArtifacts: true` is Matrix-only
- `plan-control` for an explicitly supported owned action or an external connection
  enable/disable change
- `apply` and `cancel`, referring to the reviewed plan ID

Setup-backed plans retain the existing two-minute expiry, adapter/catalog hashes,
revision checks, prerequisites, explicit Apply and durable recovery journal. The
Add flow supplies a one-resource selection directly; it never replaces a saved
setup selection/draft. It does not install or start dependency services. Matrix
software preparation uses the existing separate reviewed prepare-artifacts action.
External Devgraph is connect-only. Authenticated connections can use an existing
owner-configured `secretRef`; no new credential store or browser token capture was
introduced. A saved connection without valid credentials is not shown as ready.

The existing object API additionally exposes read-only generic projection queries:

```
GET /api/objects?operation=projection-scopes
GET /api/objects?operation=projection&scope=<encoded-scope-IRI>
GET /api/objects?operation=projection&scope=<encoded-scope-IRI>&type=<encoded-type-IRI>&includeSubclasses=true
```

These read derived scopes explicitly. They do not change default object-list or
bundle/export behavior. Subclass expansion remains bounded RDFS traversal, not a
general OWL reasoner.

## Interface

Continue opens Your Hub. All supported resource kinds appear in an on-page gallery:
registered instances show their observed status, and absent kinds show Available
to add. Configuration and review expand on the page, preserving the gallery and
Hermes input. The Resource graph tab displays indexed instances and relationships;
selecting a service opens its details. Catalog availability never masquerades as
an installed service or a graph assertion.

The guide remains the existing global component. A stopped or unconfigured guide
does not block access to the rest of Hub. Adding software, configuring it and
starting it remain distinct reviewed steps. The existing welcome and legacy
operator/workspace routes remain available; this change does not rebind them to
arbitrary services or change their execution authority.

## Validation and deployment

`npm run test:hub`, `npm run test:objects`, `npm run test:setup` and
`npm run test:deployer` exercise temporary fixtures. Tests cover matching-ID
isolation, scope replacement, restart/rebuild, stale writers, source outages,
connection preservation, unchanged saved drafts, reviewed Add, external ownership,
secret exclusion and correct VPS/Frank semantics. UI graph layout checks live in
the canonical UI component repository. No real install/download/start is needed.

The JSON-LD worker uses a fixed owned source path rather than a bundler-rewritten
module URL, and Next output tracing includes that worker and pinned ontology assets
for the object, setup and Hub routes. Expensive JSON-LD processing stays in the
bounded worker. Existing object-store path/file protections remain enabled.

The production and standalone HTTP checks are repeatable with
`node scripts/check-hub-api.mjs` and `node scripts/check-hub-api.mjs --standalone`
after building. They use disposable data and verify inherited type queries,
review/cancel, unrelated object retention and byte-identical setup/draft files.
