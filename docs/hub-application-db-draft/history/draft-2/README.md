# Hub application database — review draft 2

Status: review-only, 2026-11-22. Incorporates the software-identity, profile-composition and installation-evidence decisions. No running Hub code, registry, ontology release, service, credentials or live data have changed. Draft 1 remains under `history/draft-1`; old content-addressed fixture files remain available. User-created indexes and resource-graph reconciliation are out of scope.

## Central contract

An ontology-backed application record is a validated view of a **specific committed stored-object revision**. Matching identity and file checksums is necessary but insufficient.

A typed row binds `objectVersion = { objectId, objectRevision, profileId }`. Its `id` must equal `objectId`. The selected `StoredObjectRecord` is keyed by `(id, objectRevision)` and contains:

- asserted ontology `types` and explicit `admission` (`observation` or `infrastructure`);
- an immutable JSON-LD `jsonldFile` and a separate immutable `bindingsFile`;
- exact pinned applicable ontology/schema/manifest/context definitions.

The bindings file contains `{ objectId, objectRevision, bindings: [{ profile, value }] }`. A definition URL alone never substitutes for the binding value. The selected profile must be registered, applicable to the object's type, identity-consistent, and validated against the pinned definition. JSON-LD facts, binding values and the application view must agree under the declared field mapping. A Host mapped to an Artifact instead of a Machine is rejected even if its stored metadata and JSON-LD agree.

Application `revision` is a separate change counter. The object-backed part of the row is recoverable from its selected RDF and binding values; explicitly owned operational state is an overlay, not an independently editable copy of those facts. A direct database label change is rejected. An accepted label update must go through the object repository to commit a new RDF/binding version and then publish its application projection. Profile-only and implementation-binding changes likewise create a new object version when they change versioned binding values. Operational observations and journal progress can update their own record revision without rewriting semantic object data.

## Decisions incorporated

| Decision | Draft 2 resolution |
|---|---|
| Stable software identity | One `SoftwareDescriptor` identity for Hermes, independent of catalog membership. Catalog entries, source snapshots, builds, installations, profiles and services reference it. Its Artifact identity denotes a retained descriptor, not a callable software participant |
| Catalogs | `SoftwareCatalogEntry` is an application membership/adapter recipe with `catalogId`, local `key`, `softwareRef`, `adapterRef` and supported modes. Multiple catalogs can reference the same descriptor. This is shipped application data, not a user-created index feature |
| Source and build identities | `SoftwareSourceSnapshot` identifies an immutable Git source snapshot with a full commit hash; `SoftwareBuild` identifies an output with a content ArtifactRef. Builds may reference a known source snapshot; installations can reference either or both. Other source formats require an explicit schema extension, not a mutable branch name |
| Common profile | Small named software-configuration schema, used only when profiles are meaningful. The common final profile rejects AI-only fields |
| Hermes profile | `HermesConfigurationProfile` composes shared fields with optional `modelBinding`. A supplied model binding must specify a model plus provider or server connection. The reusable field group is open; each final composite closes with `unevaluatedProperties: false`. There is no new ontology class |
| Settings | `Hub` renamed `HubSettings`; settings are application data rather than a new Agent |
| Installation evidence | Presence, adapter compatibility, profile configuration and runtime health remain independent. Software installation can exist without a profile/service. Failed inspection means unknown; absence needs actual inspection evidence. Entry must use an installation inspection result, never infer local installation from a remote connection or an old success receipt |

## Logical record types

Names are application schema names, not declarations of ontology subclasses.

| Record | Meaning / ontology mapping | Important references |
|---|---|---|
| HubSettings | Application settings; untyped bookkeeping | local host, optional selected Hermes profile |
| Host | Actual `infra:Machine → zn:Entity` | required object version |
| SoftwareDescriptor | Retained `zn:Artifact` describing software | required object version; stable key |
| SoftwareCatalogEntry | Untyped application catalog/adapter membership | catalog identity, software descriptor |
| SoftwareSourceSnapshot | `zn:Artifact`, immutable source snapshot | descriptor; repository and full Git commit |
| SoftwareBuild | `zn:Artifact`, independently identified output | descriptor, optional source snapshot, content ArtifactRef |
| SoftwareInstallationRecord | `zn:Artifact` describing an installed copy | descriptor, host, optional source/build, object version |
| ConfigurationProfile / HermesConfigurationProfile | `zn:Artifact` retained configuration; schema composition, not subclassing | descriptor, optional installation and separately retained config file |
| ServiceInstance | Actual `infra:ServiceInstance → zn:Agent → zn:Entity` | descriptor, optional installation/profile, known hosts |
| Connection | Untyped implementation binding | explicit local lookup or unresolved external target, endpoint, opaque credential reference |
| SetupOperation | Untyped operation journal | affected records, retained plan, acknowledgement receipts |

The settings, catalog, connection and operation schemas no longer carry a generic optional `objectRef`. They can reference independently meaningful typed artifacts through explicit fields instead. This avoids implying a second ontology identity without a defined mapping.

## Field ownership

`field-ownership.json` declares every field for every typed profile, including its owner and RDF predicate where used. It also designates owners for every field of the untyped application records.

| Owner | Authority | Database treatment |
|---|---|---|
| RDF | Object identity, asserted types, mapped labels/names, known service `hostRefs` through `infra:hostedBy` | Validated projection; edits require the object repository |
| Application profile value | Structured attributes such as descriptor metadata, source/build references and profile specialization | Validated projection of the selected immutable binding value |
| Implementation profile value | Native paths, installation binding and opaque credential references where applicable | Validated projection of the selected immutable binding value; raw secrets never enter these fixtures |
| Application operational repository | Row revision/version selector; installation presence/compatibility/management; service desired state/runtime/management | Explicit operational overlay; not inferred from RDF and not authority to control a service |
| Settings/catalog/connection/journal repositories | Their application-owned fields | Separate records with referential and mutation policy checks |

This deliberately does not invent RDF predicates for every application attribute. Structured application attributes are authoritative in their schema-validated profile values. Only declared RDF fields are RDF-queryable. Moving an attribute between profile values and RDF later requires a versioned mapping/migration; it must not create two editable authorities. RDF facts not exposed as application columns remain in the RDF dataset. The review view selects single labels across the stored atomic unit and rejects ambiguous labels; it does not rewrite named-graph boundaries.

`configArtifactRef` is optional only for independently retained configuration content. It must not refer to the profile itself merely to duplicate its identity. Evidence and configuration artifacts may live in the general object store beyond the dedicated application row sets; an actual migration must resolve/preserve those references or explicitly classify unresolved external ones.

## Definition and version trust

The draft verifier reads an owner-selected `trusted-fixture-manifest.json`, never definition pins supplied only by a data row. It pins the candidate schema, field-owner mapping, source registry, exact definition snapshots and synthetic committed object-version file hashes. Files use content-addressed representation IRIs separate from stable subject IRIs.

The verifier requires applicable expanded-node schemas, registered projection definitions, Core ArtifactRef, bindings-file schema, ontology import closure and package manifests. It checks actual files, media types, lengths, content hashes, type applicability and projection values. Every locally typed named peer in an atomic export must have a consistent stored version. Only an unresolved IRI without a local type assertion can remain a bare reference.

The existing Core and Infrastructure definitions remain byte-for-byte unchanged. Candidate application projections are added to an **in-memory review registry only**. Machine/Service descriptions are not automatically admitted. Infrastructure admission must still satisfy inherited Core `EntityProjection`/InvocationContract and the existing infrastructure schemas; observations prove neither invocation conformance nor reachability/authorization. The positive review fixtures use observation admission only.

The fixture trust manifest simulates committed versions; it is not a signed release manifest, production transaction log, access-control system or migration implementation. Production must replace this test trust root with a versioned trusted application release plus the real object repository's commit records. Context-reference and arbitrary multi-graph admission scenarios need broader integration fixtures before release.

## Existing implementation and compatibility

Today, `src/lib/objects/store.mjs` persists canonical RDF, profile values, metadata and derived lookups in SQLite. It exports JSON-LD but does not maintain the required immutable per-object JSON-LD/bindings files described here. `setup.json`, per-instance receipts, native profiles, shipped component catalog and external Devgraph resource registry remain separate authoritative sources in the running Hub.

Draft 2 changes the review contract marker to `zenith.hub-application-db.draft.v2` and schema ID to `urn:zenith:hub:application-db:draft:2`. It intentionally breaks draft-1 fixture shapes; **no production decoder is switched and no live state is converted**. Draft-1 artifacts remain for comparison. The adapter/receipt/connection compatibility and alias rules will be designed before old writers are retired.

## Implementation order

1. Record-to-type and per-field ownership contracts: drafted here, with common/Hermes profile composition and immutable source/build separation.
2. Referential integrity and trusted definitions: exercised in synthetic review checks; production repository/authorization boundaries remain to implement.
3. Complete round trips: the review verifier reconstructs mapped semantic/profile views and checks canonical RDF round trips for its synthetic fixtures. Full API, update/removal, historical revision, external-reference, context and admitted-Entity integration coverage remains before interoperability is considered complete.
4. Commit/recovery design: choose one transaction owner for object versions and application projections. Durably stage verified immutable files before publishing pointers; compare expected revisions; publish one consistent snapshot; recover partial staging; preserve complete shared atomic units; collect only unreachable files. Fault injection must cover every boundary before cutover. No production commit protocol is implemented by this draft.
5. Migration design: dry-run existing setup, receipts, profiles, connections and ordinary objects; preserve identities/aliases, credentials/history and source provenance; distinguish discovery from management adoption; prove idempotence/restart recovery before applying any migration. An old projector's service/placement assertions must not be elevated into verified operational identities automatically.

## Review fixtures and checks

- `example-installed-without-guide.json`: software present, no profile/service.
- `example-generic-profile.json`: common named configuration, no AI fields.
- `example-configured.json`: specialized Hermes configuration, separate build and stopped external service.
- `make-fixtures.mjs`: creates synthetic objects, bindings, definition snapshots and the review trust root. Never reads live setup/credentials/database state.
- `verify.mjs`: validates shapes, registered type/profile compatibility, required definitions, immutable version bindings, field projections, RDF/profile reconstruction and cross-record references. Negative cases include Host label drift, Artifact-as-Host, stale revisions, mutable source branches, missing schemas, raw AI fields on a common profile, duplicate rows and unresolved local targets.

Run from the Hub repository root: `node docs/hub-application-db-draft/verify.mjs`. The result is `validation.json`. A successful fixture run is not full production interoperability, migration qualification or service health verification. These files are proposals for review; no application UI, runtime or ontology release is changed.
