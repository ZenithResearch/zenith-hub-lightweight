# Bundled catalog package and repository synchronization

The maintained software catalog is a versioned local content package in `cms/`. The Hub reads its **committed repository version** during onboarding. Source files are update inputs, not runtime database authority. This extends the application database integration; it introduces no second database, resource graph, installation executor or ontology classes.

## Reuse and authority

| Existing boundary | Catalog use |
|---|---|
| Stable SoftwareDescriptor objects | The existing six `urn:zenith:software:<key>` identities; catalog membership never creates another software identity |
| SoftwareCatalogEntry application rows | Existing catalog identity `urn:zenith:hub:catalog:builtin-software` and entry IDs `identity('catalog-entry', key)` |
| HubRepository / ApplicationCompiler | Same SQLite owner, generation/CAS, immutable JSON-LD and profile bindings, file-before-database publication and replay-safe batch |
| Published Zenith `Artifact` | Software description metadata, recipe and content-package application profiles; no Recipe class added to normalized Core |
| Existing setup controller | Review/apply, retained review Artifacts, native action guards, operation log/recovery and adapter ownership |
| Existing setup contracts and locks | Configuration schemas, defaults, capabilities, source commits and installer/model locks stay with release-owned files |
| CLI readiness | Imports on fresh initialization and checks for updates on **every initialized-root startup**, before the server starts |

New persistent content is limited to recipe/package Artifacts, metadata profiles on the existing software objects, and one versioned `catalog:active` application document. The document retains exact package source strings, imported object-version selectors and membership metadata. It is committed in the same transaction. SQLite catalog rows are validated import projections. A local row or object edit blocks subsequent imports; runtime suggestions still resolve the last committed package's exact object versions.

`logs/catalog-sync.json` reports the last attempt. It is a private diagnostic, not another catalog store; reporting failures do not invalidate a committed catalog. Setup exposes additive `catalogPackage` and `catalogStatus` fields and the gallery uses its existing warnings envelope.

## Content layout and current inventory

```text
cms/
  manifest.jsonld
  catalog.csv
  recipes.csv
  software/*.jsonld
  recipes/*.jsonld
```

Bundled version: **2026.11.23.2**. Package identity: `urn:zenith:hub:catalog-package:builtin`.

| Software | Recipes / existing supported modes |
|---|---|
| Service Management | install, connect |
| Process Runtime | install, connect |
| Frank | install |
| Devgraph | connect only |
| Matrix | install, connect; retained VPS entry explicitly **unqualified** |
| Hermes | connect, install |

The six existing software IDs, entry IDs, catalog order and defaults are preserved. Hermes's descriptor and catalog presentation are both named **Hermes**. Older default **Hermes guide** instance labels remain readable through a presentation alias; there is no second guide software identity or required named profile. Existing user model choices, provider credentials and connections are not changed.

### Manifest and index contracts

All JSON-LD uses a fixed inline context, `@id`, `@type: zn:Artifact`, and `rdfs:label`. Remote contexts, unknown fields, executable content, symlinked inputs, traversal and oversized content are rejected. Files are read only from the release's local `cms/` directory. There is no network fetch during import.

`manifest.jsonld` contains `cms:spec`: a canonical JSON **string** with `version`, `catalogId`, `publisher`, `files[{path,sha256}]` and `profiles[{path,sha256}]`. Dotted numeric versions must increase for changed packages. File hashes cover exact UTF-8 source bytes, including CSV quoting/line endings. The one allowed profile bundle is selected by release code, not by content.

`catalog.csv` headers:

```csv
entryId,catalogId,softwareId,softwarePath,label,category,position,recipeIds
```

`recipeIds` is a JSON array in a quoted CSV cell. Software identity and catalog membership identity are separate. One software can have several recipe references. Separately authored software, recipe and package objects must have disjoint IDs; even matching labels cannot merge them. Repeated references to a software ID and its intentional SoftwareDescriptor + SoftwareMetadata profile composition remain valid. Category/position and the catalog-specific label belong to membership. The software document owns its own label, key, original publisher, repository reference and description. CSV repeated software IDs are checked against the referenced JSON-LD; they cannot redefine it.

`recipes.csv` headers:

```csv
recipeId,softwareId,path
```

Recipe documents have `cms:software: {"@id": "..."}` and canonical `cms:spec` with version, maintainer, capability, mode, action allowlist, qualification/reason and exact release-contract reference. The recipe maintainer can differ from the software's publisher. A recipe references an existing adapter capability; it cannot supply shell commands, choose an arbitrary loader or redefine configuration schemas. Multiple recipe identities for one software are supported; optional `recipeId` selects an eligible recipe through the existing selection/review contract. Devgraph cannot gain an installation capability from content.

For every advertised `install` or `connect` mode, the recipes **attached to that catalog entry** must include a qualified recipe with the corresponding `install` or `connect` entry action. A configure-only supplementary recipe is allowed when another attached eligible recipe covers installation. An unattached definition cannot supply coverage. Removing the entry action without withdrawing the mode rejects the package with `catalog_entry_action_missing`; actions are never silently restored. Automatic resolution prefers a qualified matching recipe. Explicitly selecting an unqualified recipe still returns `catalog_recipe_unqualified`. Matrix VPS retains its explicit unqualified boundary and remains hidden from Add resource.

The JSON string representation deliberately stays within the current RDF codec's supported literal forms. The inner structure is closed-schema validated and checked against the RDF literal; adding an RDF `@json` codec is outside this slice. Semantic recipe → software links are direct RDF IRIs; the bound exact software revision is retained separately as a documentary reference.

### Release definitions and source pins

`profiles/catalog/` is a separately hash-qualified application-profile extension. Its manifest digest is fixed in `src/lib/catalog/pin.mjs`. It registers three application projection roles: `CatalogSoftwareMetadata`, `CatalogRecipe`, `CatalogPackage`. Base roles are copied only as an equality-checked mapping closure; they cannot redefine the established base ABI. The base `profiles/application-db/` bytes, definition-set identity, SQLite schema and published Core/Infrastructure remain unchanged.

Extension schemas, property vocabulary, mapping and release files are retained through the repository's existing immutable definition files on the object revisions that use them. Earlier object versions keep their **original** definition references. `properties.jsonld` defines application properties, not ontology classes. A future incompatible extension release needs an explicit compatible definition-loader transition; cross-release trust evolution is not implied by these tests.

`profiles/setup/component-contracts.json` owns execution/configuration facts formerly embedded in the catalog. Source references resolve the existing `release.v1.json`, Hermes installer and Matrix build manifests; artifact hashes and model/runtime choices remain in their existing authoritative locks. Repeated artifact references are equality-checked against those locks. `profiles/setup/catalog.json` is a **generated legacy compatibility mirror**, checked by `npm run catalog:check` and generated by `npm run catalog:generate`; do not maintain a second catalog there.

## Lifecycle and failure behavior

1. Validate the entire bounded package against owner-selected definitions and hashes before constructing writes. Reject cross-role object-ID collisions with `catalog_object_identity_collision` and check entry-action coverage before publication. Invalid fresh packages publish no content generation; invalid updates retain the prior complete catalog and local data.
2. Under the existing application serialization queue, compare the last imported object heads and membership projections. Local divergence yields `catalog_local_edit_conflict`; no overwrite or duplicate identity is allocated.
3. If the package digest is unchanged, make **no repository commit**, generation change or object revision. Reviews stay valid. Diagnostic file reporting is independent of DB state.
4. For a changed package, require an increased package version; changed recipe specification requires an increased recipe version. A recipe ID cannot be retargeted to another software identity.
5. Publish all object/profile/definition files and membership/snapshot changes in one repository batch. An interrupted pre-commit update leaves the previous complete catalog; a lost acknowledgement is recognized on retry.
6. Malformed or unavailable updates keep the last-good catalog and report the error. Without any valid first catalog, initialization fails explicitly with `catalog_unavailable` and no app/content commit.
7. Removing an entry retires it from active suggestions and clears its active supported modes. It does not delete descriptors, recipes, installations, connections, ordinary objects or their history. Explicit controls for an already retained instance may still use the retained recipe; retired suggestions cannot authorize a new install.

A review retains recipe ID/version, exact recipe and software object versions, recipe-content SHA256, source commit/version, release-contract SHA256, package identity/version/digest and the existing driver digest. Apply revalidates these and existing application-generation, configuration, expiry, credential and native preconditions. It never substitutes a newer recipe. A successful catalog import does not install software, inspect/adopt a native copy, configure a profile, fetch weights or start services.

Fresh/legacy database migration plans now also pin the catalog package and extension definition digests. Changing these inputs before cutover requires a new reviewed migration plan. Existing initialized application roots synchronize content additively; they do not rerun storage migration or replace their base definition set. `application.catalogSha256` remains the original seed provenance; `catalog:active` and `catalogPackage.digest` identify active content.

## Operator and maintenance commands

Normal `npm run dev`, `npm run start` and `npm run hub -- serve` go through CLI preparation. For an already initialized **stopped** private root:

```sh
npm run hub -- catalog status --setup-dir /absolute/private/hub-root
npm run hub -- catalog sync --setup-dir /absolute/private/hub-root
npm run hub -- prepare --setup-dir /absolute/private/hub-root
```

Do not run synchronization against a root served by an older binary. The earlier automated slice left the preview untouched. The subsequent authorized restart and preservation checks are recorded in [catalog/live-validation.json](catalog/live-validation.json). A pre-catalog process has a compatibility path using the unchanged generated mirror; new launcher processes set `ZENITH_HUB_CATALOG_READY=1` after preparation and read only committed content. Direct API GETs never import a changed source file. Do not manually set the readiness marker to bypass preparation.

To author a content release, edit the JSON-LD and CSV inputs, increment affected recipe and package versions, update manifest file SHA256 values, then run `catalog:generate`, `catalog:check` and `test:catalog`. Add new indexed files explicitly to the manifest and both relevant CSV references. Updating executable capabilities or source locks is a code/release review, including a new trusted extension pin; editing content cannot grant them. No CMS editor or implicit signing/trust system is provided.

## Validation and limits

See [catalog/validation.json](catalog/validation.json) for automated results and [catalog/live-validation.json](catalog/live-validation.json) for the authorized live restart. Automated tests use disposable roots and fixture inputs. The live restart retained the existing v5 repository and base definition set, backed up its database and immutable files, imported the catalog, and verified actual Continue and resource-form navigation. Native software/configuration and external service states were preserved. This establishes catalog/onboarding persistence, not installation or inference qualification.

Deferred: remote package retrieval, publisher signatures/remote trust, ontology package installation, CMS editing UI, multi-source overlays/merging, arbitrary runtime-defined object indexes and cross-release extension migration. The format separates software, catalog membership and multiple recipes; the current importer activates one local package/catalog at a time. No duplicated software identities, second DB owner, custom executor, journal or runtime index were introduced.

### Validation tightening after the independent audit

[The audit regression record](catalog/validation-fixes.json) covers matching-label ID collisions, fresh/update atomic rejection, qualified entry-action coverage across multiple recipes, intentional profile composition, exact default RDF/profile/index alignment, mode withdrawal and retained history. Valid existing packages keep their shapes, identities, modes and defaults. Previously accepted malformed packages are deliberately rejected; automatic repair of an already malformed stored snapshot is outside this change. All regression runs use copied CMS files and disposable repositories. The initial [live restart evidence](catalog/live-validation.json) predates these validation fixes. The later user-authorized [live qualification of the fixes](catalog/live-fixes-validation.json) confirms a no-op startup, the saved guide configuration, Continue, Runtime install/connect forms, Devgraph connect-only behavior, and preserved database records/history and immutable bytes. No malformed package or installation was applied to live data.

The Apps & services gallery separates configured instances from available catalog apps. Its section counts describe those two groups independently; installed, stopped, disconnected or incomplete instances retain their existing controls. Hermes uses its existing stable software identity. The former default “Hermes guide” instance label is displayed as “Hermes” without rewriting stored setup, service labels or native configuration; custom instance names remain intact. Catalog package 2026.11.23.2 changes descriptive labels and metadata only, retaining recipe capabilities and software/source identities.
