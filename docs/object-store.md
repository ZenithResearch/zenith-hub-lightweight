# Local Hub object store

The Hub can retain a local RDF dataset described by JSON-LD. This is application
storage, not an ontology release, reasoner or invocation authority. The existing
JSON resource registry remains a separate connection-configuration interface;
it is neither migrated nor replaced. Runtime, Service and Devgraph stores are
never opened by this feature.

## Runtime and location

Requires Node 24 on macOS or Linux with POSIX ownership checks. The implementation uses Node's built-in `node:sqlite`,
`jsonld` 9.0.0, `rdf-canonize` 5.0.0 and Ajv 2020-12. All npm versions are locked.

The HTTP feature is disabled unless both `ZENITH_LOCAL_OPERATOR=1` and an absolute
`ZENITH_HUB_DATA_DIR` are configured by the owner. The database is always
`objects.sqlite` within that directory. SQLite WAL/SHM files stay beside it.
The directory must be private to the current owner (0700); database files must be
0600 with no symlinks or hard links. An unrelated existing SQLite database is
rejected before mutation. The installed Hub does not configure this feature
merely by opening the onboarding page.

For a local checkout, explicitly select a new Hub-owned directory and run the
existing operator launcher:

```sh
export ZENITH_HUB_DATA_DIR="$HOME/Library/Application Support/Zenith/Hub-Objects"
npm run operator
```

The launcher supplies the loopback operator origin. This does not start any
provider, SAI application, Service, Runtime or Devgraph instance. Persistent data
survives closing/restarting Hub. The environment variable selects the location;
imported documents and API requests cannot choose it.

## Assertions and operational metadata

One representation is authoritative for assertions: **RDFC-1.0 canonical
N-Quads in SQLite `units`**. A unit contains all outgoing assertions of a named
subject across graphs, together with all assertions connected through shared
blank nodes. Two named subjects sharing an anonymous structure occupy one
atomic replacement unit. References to other named objects do not merge units.

`objects` holds operational identity-to-unit bindings, optimistic revision
counters, last-import references and separately validated JSON projections.
`imports` holds idempotency receipts, source labels, package/context provenance
and content/semantic hashes. None of these fields is inserted into the RDF graph.
Revisions are change counters, not ontology subclasses or retained historical
content versions. A JSON-LD export is a semantic interchange document, not a
backup of this operational metadata.

`object_types` and `object_links` are derived indexes. The owner CLI's
`rebuild-indexes` recreates them transactionally from `units` without changing
assertions or record revisions. All relationship IRIs are stored as supplied;
there is no fixed Devgraph/resource-kind list. List filtering uses explicitly
asserted types, not inferred superclasses.

## JSON-LD interpretation and features

Supported: expanded and compacted JSON-LD 1.1, inline contexts, explicitly pinned
URL contexts, connected documents, shared/anonymous nodes, ordered `@list`
values, unordered multivalues, typed literals, language tags, default graphs,
IRI-named graphs and blank-node graph names. Literal lexical values are retained;
exports do not coerce typed values into JavaScript native numbers.

Blank-node labels are scoped to an import. Inside each stored unit they are
canonicalized; when units are combined, their labels are standardized apart.
Thus identical `_:` labels in separate imports cannot accidentally identify the
same node. Anonymous-only imports require distinct import keys for distinct
occurrences; replaying a key reuses its original result.

Exports use **expanded JSON-LD with full IRIs**, explicit literal datatypes and
language tags. They need no remote context to be interpreted. An empty dataset exports/imports as a no-op; it creates no object assertions.
Input context
syntax, term aliases and property ordering are not preserved byte-for-byte;
the RDF dataset they express is preserved. Pinned context URLs/hashes are kept
as provenance. Inline context declarations are interpreted as document content.

Every export is converted back through the processor and compared using RDF
dataset canonicalization before it is returned. A narrow compatibility adapter
adds the missing `_:` prefix for known blank graph names emitted by jsonld
9.0.0's `fromRDF`; the full equivalence check verifies its result. No other
hand-written RDF conversion or JSON equality serves as semantic proof.

Explicitly rejected: empty datasets; empty graph declarations (RDF datasets do
not retain the existence of an empty graph); relative IRIs; generalized RDF with
blank predicates; `@direction`, expanded `@index`, and `@json` value objects.
Safe JSON-LD processing rejects constructs that would discard assertions.
Unsafe native JSON numbers are rejected; use exact typed literal strings for large integers.
A processor conversion that fails the RDF-equivalence check is rejected rather
than returned with lost data. Unsupported remote/file contexts are rejected;
external relationship IRIs are retained without dereferencing them.

Imports are limited to 1 MiB, 10,000 quads, 1,000 named subjects and bounded worker
processing. Exports are limited to 10,000 quads. At most two codec workers run at
once; saturation reports `object_store_busy`. Large store-wide exports can
require selecting smaller object sets/graphs. The owner API is local only.

## Registered ontology resources and schema profiles

Default registration: unchanged normalized Zenith **0.1.0**, archive SHA-256
`6ab9289cad7d811d0cdb2078a6261a538fbd77dbfa53db144e686bc7feafe91d` from
[its published release](https://github.com/ZenithResearch/zenith-ontology-normalized/releases/tag/v0.1.0).
The checked-in registry pins its manifest; every package file is verified before
use. No ontology class, inheritance edge, relationship or published package was
changed. The website is outside this implementation.

Owners may set `ZENITH_HUB_ONTOLOGY_REGISTRY_FILE` to an explicit registry file.
The format in `profiles/object-store/registry.json` accepts additional pinned
packages and resources. Paths are relative to that registry and confined to
its declared directories; each resource requires an exact hash. A package uses
the released `manifest.json` format with `files` and `ontologyDocuments`.
No package or schema URL is fetched while processing an import. Keep private
SAI packages in owner-private configuration, not in the public Hub repository.

Validation has separate layers:

1. JSON syntax and request-shape validation.
2. JSON-LD interpretation and RDF safe-mode/round-trip checks.
3. Recognition of asserted `rdf:type` IRIs against registered `owl:Class`
   declarations. Unknown asserted types reject the whole batch. Untyped named
   resources are retained as partial descriptions, including graph selections
   whose type assertions live in another graph; they are not reported as typed.
4. Applicable owner-registered `expanded-node` profiles validate the actual
   expanded node. Explicit `projection` bindings validate a separate JSON value
   against the exact selected schema definition/fragment. A `$defs`-only document
   root is not accepted as an admission schema.

The default EntityProjection profile selects
`core.schema.json#/$defs/EntityProjection`. It preserves the published closed
shape: `id`, `types`, `invocationContract`; machine fields or storage metadata
are rejected. A projection binding must agree with the RDF object's identity
and full type IRIs. Example import-envelope field:

```json
{
  "projections": {
    "urn:example:person": [{
      "profile": "https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json#/$defs/EntityProjection",
      "value": {
        "id": "urn:example:person",
        "types": ["https://zenith-research.ca/ontology/terms/Person"],
        "invocationContract": {
          "id": "urn:example:contract",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "byteLength": 7,
          "mediaType": "application/ld+json"
        }
      }
    }]
  }
}
```

**Definition gap:** Core publishes JSON projection/contract schemas, not a
JSON-LD node-admission mapping for their fields. This store does not invent one
or insert those fields as new ontology properties. Optional projection bindings
are validated when provided; bare Entity RDF descriptions do not establish
mandatory Addressable/Invocable conformance. Contract resolution, callable
behavior and OWL entailment remain unassessed. Semantic exports omit projection
sidecars; callers can obtain them through record reads and supply them
explicitly for separately validated admission elsewhere.

## Create, update, import and retries

All mutations run in `BEGIN IMMEDIATE` transactions. Validation/preparation is
finished before mutation. A failed batch commits no object, receipt or index
changes. API/CLI errors report the entire batch rejected, with no partial success.

- **Create** requires one selected stable IRI, absent locally. A repeated create
  under a different import key conflicts, even if its content matches.
- **Update** requires that IRI to exist and an exact `expectedRevision`.
Multiple descriptions of one IRI within one document union their RDF assertions;
there is no last-object-wins overwrite.

- **Import** creates new descriptions, reports semantically equal named units
  `alreadyPresent`, and rejects differing existing content unless an exact
  `expectedRevisions` map authorizes every affected existing object.
- A unit with shared blank nodes must be replaced in full, including all of its
  named subjects and their expected revisions. Single-object updates cannot
  detach its peers. A replacement may split/merge units when the complete
  affected set is supplied. Get responses expose the unit's peer IDs/revisions.
- Supplied expected revisions are checked even for unchanged objects. Value 0
  asserts nonexistence. Changed ontology assertions or bound projection values
  increment the affected record revision. Unchanged named records keep theirs.
- Every mutation requires `importKey`. Same key plus equivalent RDF and identical
  operational options replays the original receipt without overwriting newer
  work. Same key with different meaning/options returns `import_key_conflict`.
  Retry an unknown/lost response with the same key and request. A replay receipt
  is historical; read the record for its current revision.

`contentSha256` hashes the supplied JSON string (CLI), or `JSON.stringify` of the
API's parsed document object; `contentHashBasis` records which. It is a content
encoding hash. `semanticSha256` hashes **RDFC-1.0 canonical RDF N-Quads** and is
independent of context prefixes, object/property order or blank-node labels.
Different literal lexical forms remain different RDF terms; this is RDF dataset
isomorphism, not datatype-value reasoning or OWL logical equivalence.

## HTTP contract

The existing operator protections apply: numeric-loopback Host/origin, same-site
requests, JSON-only mutation envelopes and a server-issued CSRF token. The API
never accepts storage paths, loaders, package registrations or SQL from a request.
Responses are no-store. Mutations use `application/json` envelopes; exported
semantic documents use `application/ld+json` without the operational envelope.

All operations use `/api/objects`:

| Method | Query/operation | Result |
|---|---|---|
| GET | `operation=session` | Local CSRF token; does not initialize storage |
| GET | `operation=registry` | Pinned packages, recognized types and schema profiles |
| GET | `operation=list&type=IRI&after=IRI&limit=100` | IDs/revisions, optional asserted-type filter, next cursor |
| GET | `operation=get&id=IRI` | JSON-LD document plus separate metadata, projections and unit peers |
| GET | `operation=relationships&id=IRI&direction=outgoing` | Assertions to IRI/blank targets; optional predicate and limit |
| GET | `operation=connected&id=IRI&depth=1&limit=100` | Bidirectional named-object set, external refs, truncation flag and document |
| GET | `operation=export` | Whole dataset as `application/ld+json` |
| GET | `operation=export&id=IRI` | Selected object units; repeat `id` for several objects |
| GET | `operation=export&graph=IRI` | Selected graph; `@default` selects the default graph |
| POST | `operation=create/update/import` in body | Atomic import receipt |

Object exports include their shared anonymous unit peers and all graphs of those
units. Connected reads follow anonymous structures within units and explicit
IRI relationships, not subclass inference; depth 0 includes the initial unit.
Graph selection preserves that graph boundary and does not add missing type
assertions from elsewhere. Link responses use an empty `graph` string for the
default graph, an IRI for a named graph, or a scoped `_:` label for a blank graph.
IRI targets need not exist locally. No referenced object is fetched or invented.

POST example (with `Origin`, `Content-Type: application/json` and
`X-Zenith-CSRF` from the session response):

```json
{
  "schema": "zenith.hub-object-action.v1",
  "operation": "import",
  "importKey": "owner-import-001",
  "source": "owner-reviewed-file",
  "expectedRevisions": {},
  "document": {
    "@id": "urn:example:artifact",
    "@type": "https://zenith-research.ca/ontology/terms/Artifact"
  }
}
```

Create additionally selects `id`. Update selects `id` and `expectedRevision`.
Bulk import uses `expectedRevisions`, not `expectedRevision`. An optional
`projections` map supplies the separately validated sidecars described above.
Conflict errors use 409; missing IDs use 404; JSON-LD/schema/type admission errors
use 422; request shape/JSON errors use 400; disabled local access uses 403.

## Owner CLI and reproducible example

Run from the Hub repository with Node 24. Choose a new owner-private Hub data
directory; these commands do not touch the onboarding or service databases.

```sh
node scripts/objects.mjs init --data-dir "$HOME/Library/Application Support/Zenith/Hub-Objects"
node scripts/objects.mjs import --data-dir "$HOME/Library/Application Support/Zenith/Hub-Objects" \
  --input examples/objects/connected.jsonld --import-key example-001
node scripts/objects.mjs list --data-dir "$HOME/Library/Application Support/Zenith/Hub-Objects"
node scripts/objects.mjs export --data-dir "$HOME/Library/Application Support/Zenith/Hub-Objects" \
  --output /tmp/hub-object-export.jsonld
```

The CLI also supports get/relationships/connected, selected ID/graph exports,
`--expected-revisions` and `--projections` JSON files, `--source`, an explicit
`--registry`, and `rebuild-indexes`. Output files use exclusive creation so an
existing export is not overwritten silently. The CLI is an owner-side alternative
to the HTTP API; it does not bypass object revision or ontology/schema checks.

To run the acceptance demonstration entirely in fresh disposable directories:

```sh
node scripts/objects-roundtrip.mjs
npm run test:objects
```

The demonstration imports the checked-in connected example, closes/reopens its
database, exports, imports into a second fresh database and compares the source
and both exports by RDFC-1.0. It prints distinct content and semantic hashes.
Tests additionally cover equivalent contexts/expanded forms, unordered values,
ordered lists, language/datatype literals, shared and isolated blank nodes,
named/blank graphs, external references, conflict/stale-revision behavior,
atomic rejection, projection fragments, filesystem boundaries and unchanged
resource-registry behavior through the existing deployer suite.

References: [Node 24 SQLite](https://nodejs.org/download/release/v24.20.0/docs/api/sqlite.html),
[jsonld.js](https://github.com/digitalbazaar/jsonld.js),
[rdf-canonize](https://github.com/digitalbazaar/rdf-canonize),
[RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/).
