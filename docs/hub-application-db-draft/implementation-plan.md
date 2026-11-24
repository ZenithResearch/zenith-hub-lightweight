# Implementation plan and decision register — draft 6

The application database now owns the Hub's setup and connection state through the existing API contracts. The CLI prepares, validates and explicitly migrates storage before launching the UI. The general object repository remains independent of dedicated Hub tables. This is not the rolled-back resource graph.

The first foundation milestone and prior design are retained in [history/draft-5](history/draft-5/). The current implementation guide is [integration.md](integration.md). The additive bundled-content slice is described in [catalog.md](catalog.md); this remains the single active implementation plan.

| Decision | Resolution |
|---|---|
| Semantic authority | JSON-LD plus declared versioned profile bindings; repeated database fields are validated projections |
| Provenance | Stable software descriptor; identity-defining source/build facts immutable; installation pins exact source/build object versions |
| Presence | Server-owned bounded inspection evidence; errors/expiry mean unknown; configuration, compatibility and runtime health are separate |
| Persistence | Embedded SQLite, one repository commit owner, immutable files before database pointers, private app documents in that same commit |
| References | Semantic links RDF-queryable; explicit exact documentary versions; current action preconditions checked separately |
| Existing data | Source-fingerprinted plan/apply, consistent backups, staged round-trip validation, retained old roots, fail-closed redirects and recoverable journal |
| Native/external ownership | Native credentials/profiles/history and connected services remain with their existing owners; no implicit install, adoption or start |
| Catalog content | Bundled versioned CSV/JSON-LD package → existing repository transaction; one committed runtime catalog, exact recipe pins, unchanged imports are DB no-ops; no new executor |
| Scope | Published Core/Infrastructure unchanged, generic objects supported without app rows, no user-defined indexes or reconciliation graph |

| Work | Current status | Remaining qualification |
|---|---|---|
| Versioned repository, exact provenance, typed inspection publication | Implemented | Cross-release definitions; broader storage-platform faults |
| Full setup/configuration/service/connection mapping | Implemented through existing controller adapters | Additional adapter/native layouts as they are introduced |
| Durable setup/gallery reviews and operation artifacts | Implemented with generation checks and exact retained artifact references | Further native operation side-effect recovery scenarios |
| Default local CLI initialization / status / serve / stop | Implemented before Next startup; readiness also checked by instrumentation | Fully relocated standalone packaging beyond the current traced deployment |
| Explicit v2/fresh-root migration and journal recovery | Implemented | Unpublished v4 foundation roots deliberately require a separate converter |
| Native software inventory / registration / software-based entry | Implemented for pinned Hermes layout; unknown for unsupported inspectors | Live inspection result and limits recorded separately |
| API compatibility and restart behavior | Automated fixture coverage, production and standalone smoke | Live data cutover/readback evidence below |
| Bundled software/catalog/recipe package and startup synchronization | Implemented and activated in the existing preview; six identities/defaults, exact review pins and existing records preserved; real Continue and connect-only form verified | Remote retrieval, multi-source overlays and cross-release extension trust remain deferred |
| Independent catalog validation audit follow-up | Reject cross-role content identity collisions and missing eligible entry actions; allow intentional profile composition and multi-recipe coverage | Fixture regressions in [catalog/validation-fixes.json](catalog/validation-fixes.json); authorized restart and preservation checks passed in [catalog/live-fixes-validation.json](catalog/live-fixes-validation.json) |
| Future generic v2 review commands / redesigned UI | Not implemented in this integration | Separate scope; existing setup/gallery interfaces remain active |

The validation fixes have also been restarted and checked live: [catalog/live-fixes-validation.json](catalog/live-fixes-validation.json). Startup was a no-op at generation 8; the walkthrough added only normal entry/inspection metadata, with all 30 objects and 117 existing immutable files retained.

Initial catalog qualification used disposable roots. The authorized live restart is now recorded in [catalog/live-validation.json](catalog/live-validation.json): no schema migration was required; the stopped database and immutable representations were backed up; one catalog commit preserved existing records, and real Continue persisted only normal entry/inspection metadata. [catalog/validation.json](catalog/validation.json) retains the earlier automated evidence.

Follow-up order after this slice: inspect the live validation record, review database-backed onboarding in the running Hub, then address any native-layout or UI-specific refinement demonstrated by that review. Do not replace working setup/connection data or assume successful local inspection establishes provider inference readiness.
