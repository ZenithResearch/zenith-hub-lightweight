# Hub application database — current implementation and review

The local launcher now initializes and validates the database before serving the UI. Setup, connection and generic-object controllers use it through their existing wire contracts. Read [integration.md](integration.md) first for commands, explicit migration/recovery and qualification limits; [implementation-plan.md](implementation-plan.md) is the active scope/status register.

The schemas and mappings here are review revision 6. Runtime definitions are pinned separately under `profiles/application-db`; their bytes must agree after normalizing internal version identifiers. SQL `user_version=5` includes the repository ledger, application projections and private app document versions. Published Zenith Core/Infrastructure ontology classes are unchanged.

The diagrams distinguish application records, ontology classes, semantic relationships, versioned storage and physical SQL tables. Generate them with `node docs/hub-application-db-draft/generate-diagrams.mjs`. Synthetic schema/design checks do not substitute for the repository, migration, HTTP and native-layout evidence in `integration-validation.json`.

Prior proposals and the first opt-in foundation milestone are retained under `history/` and in `foundation-validation.json`. The remaining proposed generic v2 review endpoints are described in `repositories-and-api.md`; they are not active routes. Existing setup/gallery review interfaces remain supported.
