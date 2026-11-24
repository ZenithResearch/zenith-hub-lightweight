# Hub repository foundation and application integration

The repository foundation is now used by the local application launcher. It initializes the database before starting Next, and the existing setup, gallery, connection and generic-object controllers share it. Existing roots require an explicit, source-fingerprinted migration; reads do not perform conversion.

The old `ZENITH_HUB_REPOSITORY_FOUNDATION=1` switch remains for isolated foundation/legacy compatibility tests. Normal local launch uses `scripts/hub.mjs`, which enables `ZENITH_HUB_APPLICATION_DB=1` after preparing and validating the database. An activation marker also routes direct source consumers to that database so there is no second setup writer.

See [integration.md](integration.md) for commands, field ownership, backups/recovery and limits; [implementation-plan.md](implementation-plan.md) for current scope; `foundation-validation.json` for the earlier foundation milestone and `integration-validation.json` for current qualification. The prior draft is preserved under [history/draft-5](history/draft-5/).
