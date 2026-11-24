# Hub application database — review draft 4

Status: implementation design and executable review package, 2026-11-23. Draft 4 supersedes draft 3 (64 current contract checks plus the separate design checks; see generated reports). Drafts 1–3 remain in `history/`; content-addressed older fixture files remain retained. **No running Hub/backend/UI, private application data, credentials, service, published ontology or production registry has changed.** User-created indexes and resource-graph reconciliation remain out of scope.

The [implementation plan and decision register](implementation-plan.md) is the single active plan, including the readiness matrix and ordered acceptance criteria. This package specifies the design; it does not implement runtime storage or qualify a release.

## Confirmed model

- A typed application record is a validated projection of one specific committed stored-object revision. IDs and file hashes alone do not prove conformance.
- Hermes has one stable software-descriptor identity, independent of catalogs, source snapshots, builds, installations, profiles and services. Inventory/catalog membership is shipped application data.
- User-confirmed semantic installation/software/host/source/build links are RDF-queryable. Paths, credentials, model bindings and other structured fields have explicit separate owners.
- User-confirmed installation meaning is **one installed version**, with agreeing source/build provenance. No moving release channel disguised as one version. Upgrade creates a new installation description; aliases preserve copy history.
- Presence, adapter compatibility, configuration and service health remain distinct. Local Hermes software presence is the entry prerequisite; no mandatory guide/profile/model/server.
- ConfigurationProfile is generic. Hermes-specific fields compose into an application schema; table/record distinctions do not create ontology subclasses.

## Contracts and authorities

| Artifact | Purpose |
|---|---|
| [schema.json](schema.json) | Versioned current review snapshot, typed/untyped app records, stored versions, RDF unit records, selections and reference selectors |
| [field-ownership.json](field-ownership.json) | Versioned per-field RDF/profile/implementation/operational ownership; per-object mapping pins |
| [application-relations.jsonld](application-relations.jsonld) | Seven review-only RDF properties; imports exact existing Core/Infrastructure and declares no new classes |
| [reference-policy.json](reference-policy.json) | Current, exact historical and explicitly unresolved external references by purpose; separates retention from action eligibility |
| [persistence.md](persistence.md), [physical-mapping.json](physical-mapping.json) + [DDL 003](migrations/003-revision-ledger.sql) / [DDL 004](migrations/004-application-projections.sql) | Chosen single SQLite database, immutable file root, key/FK/index rules and legacy read-only carryover boundary |
| [repositories-and-api.md](repositories-and-api.md), [api.schema.json](api.schema.json), [commit.schema.json](commit.schema.json) | Concrete method/wire/internal batch contracts, errors, revisions, idempotency and consumer adaptation points |
| [presence.md](presence.md) | Safe inspection evidence, unknown/absence distinction, scope, 30s freshness/clock policy and software-only entry |
| [commit-protocol.md](commit-protocol.md) | One repository publication algorithm, file/SQLite boundary, crash-point recovery, retry and retention rules |
| [migration.md](migration.md) | Source mapping, aliases/duplicate rules, dry-run, backup, cutover and rollback/roll-forward |
| [diagrams.md](diagrams.md) | A application records, B ontology inheritance/imports, C RDF/implementation links, D revision/storage contract, E chosen physical DDL |

## Stored object and RDF unit rules

A typed row's `objectVersion={objectId,objectRevision,profileId}` identifies a committed version whose ID equals the row ID. `StoredObjectRecord` contains immutable JSON-LD/binding file references, asserted types, observation admission, applicable trusted definition pins and a versioned field mapping when a recognized Hub profile is present. Binding files contain actual `{profile,value}` pairs plus matching object/unit revisions. A definition URL is not a binding value.

Validate **every recognized stored binding** against its own pinned mapping and RDF, including stored historical revisions and selected objects with no app row. Then check rows against those validated views. A Host label disagreement fails even after removing the Host app row. A Host cannot be an Artifact simply because both metadata copies say Artifact. Generic objects without Hub profiles remain valid; the store is not limited to application inventory.

`rdfUnits` commits include the RDFC-1.0 digest and complete named-subject membership. Follow the existing codec: all assertions of a named subject and assertions connected through a shared blank node form one indivisible RDF unit, across graph boundaries. Typed and untyped named subjects are members; link-only/graph-only IRIs are not. Blank-only units need no invented object identity. Each member's representation must express the committed canonical dataset, even when its lexical serialization differs. Unit metadata cannot be established solely by per-object file hashes.

`selectedUnits` and `selectedObjects` select complete compatible current units. Mixed unit versions, missing members and contradictory documents are rejected. Membership changes require new unit identities; RDF changes advance the unit and all member object revisions. Binding-only edits can advance one object's revision while reusing the same RDF unit. Transaction batch identity and repository generation are separate metadata, not ontology classes or RDF units.

Historical object self-consistency is always checked. Historical cross-object links are unresolved unless explicitly pinned to an exact retained version or declared external; they never silently resolve through current state. Current/actionable references cannot use any loaded historical object as a fallback. Completed journals and disabled connections can retain exact history, while action guards require current targets and fresh preconditions. Known contradictory local types cannot escape checks via an external declaration. Configuration content, plans/evidence and receipts have distinct expected type rules.

The review schema/transport is draft 4, a deliberate breaking change to earlier **review fixtures**, not a production API switch. Cross-release historical definition-set loading and existing admitted-object conversion require implementation qualification. The observation-only review verifier explicitly rejects infrastructure admission. Production migration must preserve pre-existing admitted objects/policies through the existing full bundle validator as read-only carryover; it cannot downgrade, drop or newly admit them through this review harness.

## Verification

Run from the Hub repository root, in this order after model changes:

```sh
node docs/hub-application-db-draft/make-fixtures.mjs
node docs/hub-application-db-draft/generate-diagrams.mjs
node docs/hub-application-db-draft/verify.mjs
node docs/hub-application-db-draft/verify-design.mjs
```

The builder reads synthetic historical examples and source definition files only. The owner-selected fixture trust root pins schemas, mappings, registry, reference policy, definition snapshots, immutable object versions and complete unit commits. Independent adversarial probes construct otherwise consistent stored versions in memory; rejection cannot be hidden behind a trivial stale checksum or missing app row.

- [validation.json](validation.json): object/profile/RDF/unit/reference controls, generic/untyped/anonymous cases, exact history, source/build provenance and limited action revision eligibility.
- [design-validation.json](design-validation.json): closed API/internal schemas, actual scalar/array/composed/union diagram types, recursive/unresolved fallbacks, in-memory DDL/FKs/uniqueness, pure presence policy, synthetic migration identity/replay and unchanged runtime-source checks.
- `diagrams/model.json` / `physical-model.json`: material input hashes, schema-derived field types and edge endpoints. Opaque `adapterRef`, `credentialRef`, `endpointPolicyRef` are strings; `catalogId` is an IRI. No Ref-suffix guessing.

SQL checks run in `:memory:` only. Presence checks are pure synthetic classification/freshness, not native installation inspection. Migration checks exercise metadata identity/replay, not live conversion. There are no production HTTP/controller, crash/power-loss, actual backup/restore or admitted migration qualification claims. Mermaid source/type/edge/provenance checks pass; no installed layout renderer was available, so visual layout was not inspected. No software or rendering dependencies were installed.

## Readiness boundary

Chosen initial architecture: one private SQLite database, immutable files promoted durably before one SQLite publication, validated app projections and explicitly owned operational state. Initial implementation slice: software inventory + software-based Hermes entry. Future named profile/service management stays separate.

The design is ready to start the ordered implementation when both synthetic reports pass. Production implementation and qualification remain pending; their concrete tests and acceptance criteria are in the plan. No live migration, PR, push or release is authorized by this package.
