# Open the empty process workspace

The workspace uses its own `Process-Workspace` installation: Runtime 8292 and Service 8291. It preserves the default Process installation and optional Process-Pilot local review. The owner bootstrap prepares the reviewed base profile and a public finite native setup plan; follow the profile's README for that separate preparation. Bootstrap does not choose a review workflow, seed an SOP/process, create a run, register an actor or enable a provider.

## Start the local UI

From the prepared, built Operator checkout, start this profile in one place:

```sh
cd "$HOME/Library/Application Support/Zenith/Operator"
ZENITH_PROCESS_PROFILE=workspace \
ZENITH_PROCESS_ROOT="$HOME/Library/Application Support/Zenith/Process-Workspace" \
ZENITH_RUNTIME_PORT=8292 ZENITH_SERVICE_PORT=8291 npm run operator:start
```

Open **http://127.0.0.1:4208/workspace** (also the root page for this profile). Existing `.env.operator.local` remains owner configuration; the explicit profile/root/ports above select this isolated workspace. The browser cannot choose another host executable, namespace, root or policy.

The initial page has no selected process or run. **Prepare native setup proposal** creates or refreshes only the public setup proposal with a one-hour command permission window while the workspace is stopped and custody is absent. It creates no key or grant; an expired proposal can be refreshed through this same reviewed path. **Set up workspace identity** is then available only when that plan exists and native custody has not been created. Review its destination, exact public plan digest, **Command permission window** (at most one hour), separate **Machine identity key expires** timestamp (at most 365 days after the command window starts), and fixed authoring/read scope. The machine key can outlive an expired command permission; key possession does not extend that permission. The UI does not renew permission or rotate keys automatically. You control identity revocation. Existing or partial custody is retained. Native configured means source functionality is configured; it does not mean production qualification. **Start workspace** starts its owned local services after setup. Execution/providers remain disabled.

## Draft, validate, save, publish

1. Enter a process ID and click **Create unsaved draft**. The starter is editor text only and is never automatically saved. Edit its inputs, typed steps, dependencies and bindings; the JSON schema is `process.draft.v1`. The starter's one blank step does not choose a provider or run.
2. Click **Validate draft**. Frank checks the public Runtime contract and pure compiler/DAG/type rules. Schema acceptance and successful compilation are different checks; validation saves nothing and grants no execution authority.
3. Click **Review save draft**. Inspect the exact payload SHA256, process resource, request ID and expected Runtime version. New drafts require `expected_version:null`; edits use the loaded record version. **Apply reviewed action** sends the exact retained request through the fixed Frank CLI and canonical Runtime API.
4. Enter a new immutable version ID and click **Review publish version**. This publishes the saved draft revision with the observed Runtime resource version. Unsaved editor changes must be saved first. Publishing creates an immutable process version, not a Run or actor.

Hub has no process business database. Runtime owns drafts, revisions, immutable versions and results. Catalog entries are observations from bounded public event pages; **Load process catalog** and **Load next page** are explicit actions. An exhausted suffix page is not a complete catalog. The UI does not poll native queries, rotate identities or prune native journal history. Use **Load current draft** to refresh a selected record before another edit; Runtime CAS rejects stale versions.

Unknown command outcome is not permission to create a replacement request. Keep the reviewed request ID and use **Recover an unconfirmed save or publish** to review **Resume retained command**. Successful apply retries return the same retained result; Frank's durable journal handles process restarts and uncertain Runtime outcomes. Cleanup/capacity/permission failures remain explicit and preserve private owner diagnostics.

The optional local-review recipe remains separate and is not part of this workspace bootstrap. Real provider choice, SOP compilation beyond explicit JSON, actor execution, result authority and installed native qualification are independent follow-up work. This UI does not imply those are enabled.

See [the bridge details](workspace-ui.md) for request bounds, exact Python/Frank handoff and source-only test scope.

## Renew an expired permission

Keep the existing identity. Stop the workspace, use **Prepare permission renewal**, then review **Renew workspace permissions** for the same five authoring/read scopes and at most one hour. Start the workspace separately after success. A retained transition offers only exact-plan resume when cleanup permits it. An older installed controller first needs the allowlisted offline software upgrade. See [the renewal and software upgrade guide](workspace-permission-renewal.md) for exact commands, receipts and recovery limits.
