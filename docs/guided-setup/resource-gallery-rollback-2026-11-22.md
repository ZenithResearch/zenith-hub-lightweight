# Resource gallery rollback — 2026-11-22

At the owner's request, retain the compact cloud-themed gallery and roll back the experimental resource graph.

- Remove `ProjectionIndex`, its source-scoped reconciliation code, graph query operations, graph layout/view, graph tab and graph identity section.
- Derive gallery rows directly from existing setup registrations and external connection records. Reads/refreshes do not open or write the general object store. A temporary owner-read failure shows the last successfully loaded rows in memory as unverified with controls disabled; a process restart does not claim a persistent graph fallback.
- Keep per-card Add, inline configuration, reviewed apply/cancel, connection controls and the Hermes guide. Remove the global Add resource button and use a labeled refresh icon.
- Preserve the general object API, ordinary stored objects, credentials, setup drafts/registrations, service data and every SQLite table. Previously written projection tables are left inert; no data migration or deletion is performed.
- Restore the pre-feature setup-completion observer (`projectEnvironment`) and its original import behavior. It runs only after an explicit setup apply; it is not a gallery read/reconciliation loop. Retain the shared JSON-LD worker path fix required by the existing general object API.
- Preserve all unrelated ongoing onboarding, model and welcome changes.

Source-only rollback archive: `/Volumes/home/bananawalnut/artifacts/resource-graph-rollback-2026-11-22-4467d9b3`. Its manifest records file hashes; no database, credentials or service data were copied there. The removed UI source also remains in local Git history. No remote push or service installation is part of this change.

## Validation

- Canonical UI library build/type generation, source provenance and all 6 retained cloud/reply tests pass. UI commit: `473ffc9` (`Retain resource gallery without experimental graph`); exact source bytes vendored into Hub with matching provenance.
- Hub typecheck, source provenance and all 181 Hub/setup/object-store/deployer Node tests pass.
- Production webpack build passes. Production and standalone Hub API fixtures pass gallery reads, reviewed Add/cancel and preservation of unrelated objects and setup/draft bytes. Existing production object API and setup API qualification scripts pass.
- Live `http://127.0.0.1:4318/hub` verified: compact six-card gallery, one registered resource, no graph tab/identity section or global Add action, accessible refresh icon and retained inline card flow. A card flow was opened and closed without review/apply. No service was installed, started or connected.
- Live setup revision remains 37; setup SHA256 before/after: `06864caadc7ac2513cf51d8feca7a32d5ff8b38c12686e7cc40e3f11fc6d76ae`. Existing projection scope revisions remained 39 and 3703 with unchanged observation timestamps across refresh and browser checks. The old tables remain present and unused by gallery reads.

