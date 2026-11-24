# Hub application database — review draft 1

Status: proposed logical schema, updated 2026-11-22 with mandatory JSON-LD storage references. No runtime integration, migration, ontology publication, service operation or live-data conversion is included. The software inventory is part of the application model. User-created object indexes are deferred.

## What exists today

There is storage infrastructure and several application contracts, but no single schema governing the whole Hub application:

| Existing source | What it owns today | Gap |
|---|---|---|
| `src/lib/objects/store.mjs`, documented in `docs/object-store.md` | General SQLite JSON-LD assertions, identity/revisions, profile bindings, import provenance and derived type/link indexes | These are storage tables, not a complete application model for software/installations/profiles/connections |
| `src/lib/setup/state.mjs` and `setup.json` | Onboarding progress, selected component drafts, registered instances and operation journal | Installation, profile and runtime concerns are mixed in instance records; state validation is partial code rather than one full JSON Schema |
| `profiles/setup/catalog.json` and `catalog.schema.json` | Shipped component names, adapters, sources and installation recipes | Catalog entry is not evidence that software is installed |
| `profiles/resources.schema.json` and `src/lib/resource-registry.mjs` | Existing external Devgraph connection bindings | Separate limited registry; does not cover the whole Hub |
| `instances/*/receipt.json` and native profile configuration | Managed-install outcomes, paths, source revision and per-profile configuration | Useful provenance; a previous successful install does not establish current filesystem presence |
| `profiles/object-store/ontology/infrastructure` | Proposed unpublished Machine, ServiceInstance, Deployment and related definitions/profiles | Defines meaning/admission, not the complete Hub application persistence schema |

Existing owner files remain authoritative until an explicit migration is designed and applied. This draft does not activate a second writer.

## Proposed logical records

These are application record/schema names, not declarations of new ontology classes. Candidate table/collection boundaries follow independently meaningful identities rather than copying each source-file boundary.

| Record | Principal fields | Meaning and ontology mapping |
|---|---|---|
| Hub | `id`, `revision`, `label`, optional `localHostRef`, optional `selectedGuideProfileRef` | App settings. The settings record describes the Hub; it does not automatically constitute an Agent. A retained configuration document can use Artifact |
| Host | `id`, `label`, `kind` | Refers to the actual host: existing proposed `infra:Machine → zn:Entity`; its description and evidence are separate |
| SoftwareCatalogEntry | `id`, `key`, `label`, `publisher`, `repository`, `adapterRef`, `supportedModes` | Application-owned catalog metadata. No new Software participant class; a retained catalog description can be an Artifact |
| SoftwareRelease | `id`, `softwareRef`, exact source revision, optional manifest/content hashes | A particular source snapshot or build output: `zn:Artifact`. A human version label alone is not an immutable pin |
| SoftwareInstallationRecord | `id`, `softwareRef`, optional `releaseRef`, `hostRef`, management, implementation locations, presence and compatibility observations, receipt refs | Maintained description/evidence of an installed copy: `zn:Artifact` with an application schema. The record is not the service or the host. A release may be unresolved during discovery |
| ConfigurationProfile | `id`, `softwareRef`, optional `installationRef`, `name`, configuration reference, private native-home binding, credential references, model binding | Configuration schema; independently retained configuration uses Artifact. Several profiles may share one installation. The profile is not an Agent |
| ServiceInstance | `id`, `softwareRef`, optional installation/profile references, label, management, known host refs, desired state and optional runtime observation | Operational service with independent identity/lifecycle: proposed `infra:ServiceInstance → zn:Agent → zn:Entity`. Does not exist merely because a package is installed |
| Connection | `id`, `targetRef`, `adapterRef`, endpoint, enabled, optional credential/policy references | Application implementation binding to an identified target. Connection registration does not assert a local installation, adopt its process, or establish runtime health |
| SetupOperation | `id`, `action`, `targetRefs`, state, outcome, timestamps, optional plan/receipt refs | App operation journal. An acknowledged outcome can reuse `zn:Receipt → zn:Artifact`. No ontology class per operation state |

Presence, compatibility and runtime observations are embedded value structures with their own state/time/method/evidence. They are not additional classes. Software identities, installation identities and profile identities are distinct. Paths, endpoints, PIDs and native names are bindings, not logical identifiers.

## Required object-storage contract

Every application-managed object with an ontology type MUST have a persisted JSON-LD file in object storage and a corresponding `StoredObjectRecord` in the application database's logical `objectRecords` catalog. This is a required storage contract, not an optional export. It is not a user-defined object-index feature.

- `StoredObjectRecord.id` is the object's stable IRI and matches the JSON-LD subject's `@id`. `types` matches its asserted full-IRI `@type` values. Inherited parents are resolved from pinned ontology modules rather than redundantly asserting every ancestor.
- Each typed application row has a required `objectRef` to that catalog identity. In this draft, Host, SoftwareCatalogEntry, SoftwareRelease, SoftwareInstallationRecord, ConfigurationProfile and ServiceInstance are typed. Catalog/profile/installation rows denote retained information/configuration records where typed Artifact; this does not turn their described software/host/service into Artifact. Hub settings, connection bindings and operation bookkeeping may remain untyped app records. If any is given an ontology type, its `objectRef` becomes mandatory too.
- `jsonldFile` contains an owner-resolved object-storage key and the existing Core `ArtifactRef` structure, referenced by its exact versioned JSON Schema `$ref`: content IRI, SHA256, byte length and media type. This identifies the stored representation; it is distinct from the subject's stable identity. JSON-LD media type MUST be `application/ld+json`.
- `definitions` pins the applicable versioned ontology module(s), schema definition(s), contexts if used, and package manifests. A schema reference can identify an exact fragment such as `.../infrastructure.schema.json#/$defs/MachineObserved`; its file digest is for the complete schema document. Verify import/reference closure locally using the registry. A URL alone or a mutable `latest` reference is insufficient.
- App profiles reuse exact existing definition files where applicable. The closed Core `EntityProjection` remains a separate binding; app-only fields must not be inserted into it. Merely having Machine/ServiceInstance JSON-LD does not establish Addressable/Invocable admission.
- If the Hub asserts a type for an external target, its locally retained description must also follow this contract. An unresolved IRI reference with no locally asserted type remains a reference; it must not be given invented type/health/conformance facts.

JSON Schema checks the reference shape. Repository validation must additionally resolve every reference, verify bytes/hashes/media types, check `@id` and asserted types, validate against applicable definitions, and enforce identity equality/required `objectRef` across the selected record type. A typed app row with no stored JSON-LD is invalid.

The existing object store currently keeps canonical RDF in SQLite and generates JSON-LD exports; it DOES NOT yet implement these mandatory per-object files. An object repository must own both that canonical RDF and the persisted JSON-LD representations, with one versioned write protocol and equality checks. Files are not an independently editable second source of truth. Application columns reflecting ontology facts are validated projections; application-only operational values remain separate. Semantic field-to-RDF/profile mapping and complete round-trip coverage must be specified before runtime adoption.

Use immutable files per object version. Stage/verify a file before committing its database reference; only committed references become visible, and interrupted staging is recoverable. A database failure can leave an unreferenced immutable file, never a committed dangling reference. Referenced versions must not be removed during cleanup. Shared blank-node atomic units must retain their complete export closure; each object's own referenced JSON-LD file may include the other named subjects in that unit, as the current exporter already does. File identities are separate from subject identities.

## Relationships

- One catalog entry can have many releases and many installations.
- One installation identifies one host and may identify one known release.
- One installation can support many configuration profiles and many operational services.
- A profile does not require a running service. An installed package does not require a profile.
- A service may be external, with no locally known installation/profile/host. Unknown remote placement remains unknown.
- A connection references a target; its endpoint is not that target's stable identity. The minimal Hub-managed targets are services; an external logical target can remain unresolved. This grants no new invocation authority.
- An independent placement object may later use the existing `infra:Deployment`; it is not required for every software installation. Network, volume and DNS objects remain available through the existing infrastructure extension when independently needed.
- Model provider/name/server selection remains a profile binding in this draft. A model server with its own operated lifecycle can use ServiceInstance; weights can use Artifact. No mandatory Model or Guide class is introduced.

## Shape and integrity boundaries

`schema.json` validates a logical snapshot of these records plus their mandatory stored-object references. It is a review/interchange fixture, not a decision to store one giant JSON document or introduce a new SQLite database.

Repository/transaction validation must additionally enforce:

1. Unique logical IDs across records and unique catalog keys. Stable installation IDs survive rescans; multiple profiles or aliases must not manufacture duplicate installations. Do not mint an identity on every read or identify a host by one Hub-root directory.
2. Local reference integrity for host/software/release/installation/profile records. Where a service references both a profile and an installation, the profile's known installation must agree. Release, profile, installation and service software references must agree. The Hub's selected guide must reference an existing profile. Connections may explicitly reference unresolved external targets; evidence/receipts/configuration artifacts may live in the general object store. Never invent their classes or fetch them automatically.
3. `hub-managed` means the Hub has explicitly accepted management; it does not follow from discovery. An external service uses desired state `unmanaged`. Endpoints and filesystem bindings continue through existing endpoint/credential/path guards. Only opaque credential references enter these records; tokens/passwords remain in the private credential owner.
4. An observation may be stale. Receipts, old paths, profile existence and remote reachability never independently establish current local presence. Inspection failure produces `unknown`, not `absent`. Unsupported adapter compatibility does not mean software is missing.
5. Software source or content can be registered only with provenance appropriate to that action. A discovered source revision is not an integrity guarantee; installing a release still requires the existing immutable manifest/hash checks.
6. Record revisions advance for durable changes. Dynamic read-time health/freshness does not force a rewrite of the installation record on every gallery request. Explicit observation persistence is a separate write, with a bounded retention policy if history is later retained.
7. Operation outcomes remain independent from operation state. Migrating an old `complete` entry must inspect its result/error; do not blindly turn it into a success. Use expected revisions and idempotency keys for mutations, with explicit partial/unknown-outcome recovery.
8. Ordinary observations do not constitute admitted Entity invocation conformance. Existing `EntityProjection` and infrastructure admission requirements remain separate and unchanged.

## Hermes example

`example-installed-without-guide.json` is synthetic: one host, a catalog entry for Hermes, one versioned source record and one observed installation; no profile, service or connection. It makes no claim about the user's machine or qualification of a release. The `objectRecords` entries point to real synthetic JSON-LD files under `object-storage/objects`, with exact definition snapshots under `object-storage/definitions`. Those files demonstrate identity/type/label storage and verified definition references; they do not yet encode every application field or establish a complete projection round trip. Application-field RDF/profile mappings remain an implementation gate. That is enough to review software-presence modeling and the required storage linkage. Onboarding's exact presence-confirmation/freshness rule will be implemented in the command/observation layer, not inferred from a Guide object.

The shipped software catalog is application data. It is not a user-defined index and does not require an ObjectIndex model or a resource-graph reconciliation loop.

## Persistence and migration plan

First review these logical boundaries. Keep physical storage selection explicit: the existing object store can hold ontology objects/application profile values; operational settings, bindings and journals may use application tables or repositories. Choose their authoritative layout and transaction boundary before writing migrations. Do not maintain two authoritative copies of an installation record in `setup.json` and the object store.

Then:

1. Define the registered application schemas and complete field mapping to existing ontology objects/profiles, including which values remain metadata/bindings. Require stored JSON-LD and pinned definition references for every typed object. Add full mapping/round-trip checks before claiming application-schema interoperability is implemented.
2. Add compatible object-file and database repository interfaces, coordinated staging/commit/recovery, and a versioned migration mechanism with dry-run output. Review cross-file-to-database atomicity and recovery before switching writes.
3. Import the shipped catalog without overwriting user-owned installations or settings. Convert existing setup/resource/receipt references idempotently; preserve all old IDs or an explicit alias map, native profiles, credentials, operational data and unrelated objects.
4. Update software discovery, welcome entry and gallery consumers. The gallery's Hermes card reports installation presence; runtime controls and profile setup remain explicit.
5. Validate old and new readers/fixtures, migration replay/recovery and restart behavior before retiring old writers. Shared UI changes must be finalized/committed in the component library before vendoring into Hub.

Out of this draft: user-created indexes, the rolled-back resource graph, application data owned by SAI/Devgraph/Service/Runtime, live migration, model downloads and service provisioning.

## Review-fixture verification

Run `node docs/hub-application-db-draft/verify.mjs` from the Hub repository root. The verifier reads the existing pinned ontology registry and synthetic files only; it never opens the live Hub database. The latest result is in `validation.json`: four typed objects/four JSON-LD files, with eight passing positive/negative checks. This verifies identity/type/file/definition linkage for the fixture, not complete application field interoperability, live migration, invocation admission or runtime health.
