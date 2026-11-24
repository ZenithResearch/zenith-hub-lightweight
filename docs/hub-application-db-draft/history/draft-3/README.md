# Hub application database — review draft 3

Status: review-only, 2026-11-22. Incorporates the software-identity, profile-composition and installation-evidence decisions, plus the independently audited reference and snapshot corrections. User-confirmed decisions (2026-11-22): semantic installation/software/host/source/build relationships are RDF-queryable, and each installation record describes one installed version with agreeing source/build provenance. Paths, credential references and other implementation bindings remain separate. No running Hub code, registry, ontology release, service, credentials or live data have changed. Drafts 1 and 2 remain under `history/draft-1` and `history/draft-2`; old content-addressed fixture files remain available. User-created indexes and resource-graph reconciliation are out of scope.

## Central contract

An ontology-backed application record is a validated view of a **specific committed stored-object revision**. Matching identity and file checksums is necessary but insufficient.

A typed row binds `objectVersion = { objectId, objectRevision, profileId }`. Its `id` must equal `objectId`. The selected `StoredObjectRecord` is keyed by `(id, objectRevision)` and contains:

- asserted ontology `types`, explicit observation-only admission, and `atomicUnit: { id, revision }`;
- an immutable JSON-LD `jsonldFile` and a separate immutable `bindingsFile`;
- exact pinned applicable ontology/schema/manifest/context definitions.

The bindings file contains `{ objectId, objectRevision, atomicUnit, bindings: [{ profile, value }] }`. A definition URL alone never substitutes for the binding value. The current snapshot additionally carries `selectedObjects: [{ objectId, objectRevision }]` and `snapshotMode: current`. Every typed row must bind its selected object revision. Selected peers from one atomic unit must use one compatible unit revision; any older loaded peer cannot justify a mixed current view. Historical object versions may remain in storage but do not alter this current selection.

The selected profile must be registered, applicable to the object's type, identity-consistent, and validated against the pinned definition. JSON-LD facts, binding values and the application view must agree under the declared field mapping. A Host mapped to an Artifact instead of a Machine is rejected even if its stored metadata and JSON-LD agree.

Application `revision` is a separate change counter. The object-backed part of the row is recoverable from its selected RDF and binding values; explicitly owned operational state is an overlay, not an independently editable copy of those facts. A direct database label change is rejected. An accepted label update must go through the object repository to commit a new RDF/binding version and then publish its application projection. Profile-only and implementation-binding changes likewise create a new object version when they change versioned binding values. Operational observations and journal progress can update their own record revision without rewriting semantic object data.

## Decisions incorporated

| Decision | Draft 3 resolution |
|---|---|
| Semantic relationships — confirmed | Installation/software/host/source/build links are RDF-queryable. Native paths, credential references and other implementation bindings remain separate versioned values |
| Installed version — confirmed | One `SoftwareInstallationRecord` describes one installed version. When both source and build references are supplied, the build must declare that exact source snapshot |
| Stable software identity | One `SoftwareDescriptor` identity for Hermes, independent of catalog membership. Catalog entries, source snapshots, builds, installations, profiles and services reference it. Its Artifact identity denotes a retained descriptor, not a callable software participant |
| Catalogs | `SoftwareCatalogEntry` is an application membership/adapter recipe with `catalogId`, local `key`, `softwareRef`, `adapterRef` and supported modes. Multiple catalogs can reference the same descriptor. This is shipped application data, not a user-created index feature |
| Source and build identities | `SoftwareSourceSnapshot` identifies an immutable Git source snapshot with a full commit hash; `SoftwareBuild` identifies an output with a content ArtifactRef. Builds may reference a known source snapshot; installations can reference either or both. When both installation source and build are present, the build must declare that exact source snapshot. A mixed source/build development environment needs an explicitly different future model. Other source formats require an explicit schema extension, not a mutable branch name |
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
| RDF | Object identity, asserted types, mapped labels/names, declared software/host/source/build/installation/configuration links, known service `hostRefs` | Validated projection; edits require the object repository |
| Application profile value | Structured attributes such as descriptor metadata, content byte-reference metadata, model selection and profile specialization | Validated projection of the selected immutable binding value |
| Implementation profile value | Native paths and opaque credential references where applicable | Validated projection of the selected immutable binding value; raw secrets never enter these fixtures |
| Application operational repository | Row revision/version selector; installation presence/compatibility/management; service desired state/runtime/management | Explicit operational overlay; not inferred from RDF and not authority to control a service |
| Settings/catalog/connection/journal repositories | Their application-owned fields | Separate records with referential and mutation policy checks |

Declared semantic relationships are now RDF-queryable. `application-relations.jsonld` defines seven review-only object properties (`app:`); it imports exact Core and Infrastructure definitions and adds no ontology classes. It is not registered in the running Hub or published as a release. In particular, `app:installationHost` describes where the software copy is installed, rather than falsely claiming that the description Artifact is hosted there.

Structured attributes not declared as RDF fields remain authoritative in schema-validated profile values. The complete interoperable object version is JSON-LD + bindings + definitions; JSON-LD alone still does not carry every implementation or structured-profile value. Moving an attribute between profile values and RDF later requires a versioned mapping/migration; it must not create two editable authorities. RDF facts not exposed as application columns remain in the RDF dataset. The review view selects single labels across the stored atomic unit and rejects ambiguous labels; it does not rewrite named-graph boundaries.

`configArtifactRef` is optional only for independently retained configuration content. It must not refer to the profile itself merely to duplicate its identity. Evidence and configuration artifacts may live in the general object store beyond dedicated application row sets. The verifier resolves these targets against the exact current object selection and checks inherited ontology types: config/plan/evidence targets must be Artifact or a subclass, and receipt targets must be Receipt or a subclass. Self-referencing `configArtifactRef` is rejected.

Unresolved references default to an error. An exact `externalReferences` declaration (`ownerRef`, field JSON pointer, `targetRef`) permits an unresolved external target without inventing its type, availability or authority. A declaration cannot bypass a contradictory known local type. Duplicate/unused declarations are rejected. Connection target lookup already has its explicit `targetScope`; it does not imply physical location or process ownership. Raw endpoint/credential handles are implementation values rather than ontology object references.

## Definition and version trust

The draft verifier reads an owner-selected `trusted-fixture-manifest.json`, never definition pins supplied only by a data row. It pins the candidate schema, field-owner mapping, source registry, exact definition snapshots and synthetic committed object-version file hashes. Files use content-addressed representation IRIs separate from stable subject IRIs.

The verifier requires applicable expanded-node schemas, registered projection definitions, Core ArtifactRef, bindings-file schema, ontology import closure and package manifests. It checks actual files, media types, lengths, content hashes, type applicability and projection values. Every locally typed named peer in an atomic export must have a consistent stored version. Only an unresolved IRI without a local type assertion can remain a bare reference.

The existing Core and Infrastructure definitions remain byte-for-byte unchanged. The additional application relation file is review-only. Candidate application projections are added to an **in-memory review registry only**. Machine/Service descriptions are not automatically admitted. **This draft verifier now explicitly rejects infrastructure admission.** Its earlier partial validation path did not run the complete contract-content/resource and relationship pipeline. Admission must not be offered until that entire existing registry pipeline is reused and qualified. Existing production registry behavior is unchanged; inherited EntityProjection/InvocationContract and infrastructure relationship constraints remain mandatory when admission is eventually implemented.

The fixture trust manifest simulates committed versions; it is not a signed release manifest, production transaction log, access-control system or migration implementation. Production must replace this test trust root with a versioned trusted application release plus the real object repository's commit records. Context-reference, general multi-graph export and complete admitted-Entity scenarios still require broader integration coverage before release. The synthetic shared-blank-node tests now include complete compatible units and rejection of mixed current unit revisions.

## Existing implementation and compatibility

Today, `src/lib/objects/store.mjs` persists canonical RDF, profile values, metadata and derived lookups in SQLite. It exports JSON-LD but does not maintain the required immutable per-object JSON-LD/bindings files described here. `setup.json`, per-instance receipts, native profiles, shipped component catalog and external Devgraph resource registry remain separate authoritative sources in the running Hub.

Draft 3 changes the review contract marker to `zenith.hub-application-db.draft.v3` and schema ID to `urn:zenith:hub:application-db:draft:3`. It intentionally evolves earlier review fixture shapes; **no production decoder is switched and no live state is converted**. Earlier draft artifacts remain for comparison. The adapter/receipt/connection compatibility and alias rules will be designed before old writers are retired.

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

## Updated diagrams and independent audit resolution

[Current diagrams](diagrams.md) are generated from the schema, field-owner mapping, Core/Infrastructure class declarations and the review-only application predicates. A is the logical relational application model; B is ontology inheritance/imports; C shows RDF relationships between application schema roles (not new classes); D shows object versions, atomic selection, files and bindings.

Run `node docs/hub-application-db-draft/generate-diagrams.mjs` after model changes. The generator verifies field paths and edge endpoints and records source hashes in `diagrams/model.json`. Prior conversation diagrams describing `Hub`, `SoftwareRelease`, sidecar-only installation links or unversioned `objectRef` are superseded. The source checks establish schema/edge consistency; final layout is rendered by the Mermaid viewer.

The independent audit's admission gap is closed by rejection, not by claiming full admitted support. Typed config/plan/receipt/evidence checks now cover general stored objects and explicit external declarations. Current selections are tied to compatible atomic commits. Source/build provenance enforces the user-confirmed single-installed-version rule. Semantic links are now RDF-owned, while nonsemantic implementation values remain separate. Adversarial probes create new immutable versions and commit entries in memory, so reference failures cannot be masked by a trivial checksum or projection mismatch.
