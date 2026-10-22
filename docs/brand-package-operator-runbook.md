# Brand package operator runbook

Status: source-qualified orchestration; no released bundle or production Run is
claimed by this document.

The workspace installer composes the first `zenith.anima.brand-package` Run in
three explicit authority phases. The owner first selects finite Runtime
authority for `frank-hermes-pilot` and the exact Run, executes only the reviewed
automated steps, then selects `zenith-brand-reviewer` for the same Run at the
`human-approval` boundary. After the pinned decision is committed, the owner
selects the automated actor again for `package-deliverables`.

`workspace-provider-frank-operation` reads
`config/provider-frank-operation.json`. The file is closed
`hub.provider-frank-operation.v1` data with these fields:

```json
{
  "schema": "hub.provider-frank-operation.v1",
  "action": "execute",
  "config_sha256": "<sha256 of config/frank-live-provider.json>",
  "run_id": "<exact handoff-derived Run>",
  "step_id": "qualify-intake",
  "request_id": "<stable claim request ID>",
  "effect_key": null
}
```

The allowed actions are `check-config`, `register`, `work`, `execute`, `resume`
and `renew`. `execute` accepts only one of the seven automated brand step IDs,
always passes the `compute` connector operation, and fixes the connector scope
to `zenith.anima.brand-package`. `resume` and `renew` select one retained effect
key. Other fields must be `null` when the action does not use them.

`workspace-provider-review-operation` reads
`config/provider-review-operation.json`. It supports `register`, `work`, `claim`
and `decide` for `zenith-brand-reviewer`. `claim` requires a stable request ID.
`decide` requires the SHA-256 of the exact owner-private
`config/brand-approval-decision.json`; the decision contains the fenced claim,
input digest, explicit approval or rejection, reason, and stable artifact and
terminal request IDs.

For either action, pass the operation file's SHA-256 using
`--selection-sha256`. The Hub checks that the current Runtime grant names the
expected Actor and Run, the Runtime listener is the installed workspace
listener, and every selected configuration/decision file still matches its
reviewed digest before it starts Frank. An automated grant cannot run the human
CLI, and a reviewer grant cannot run Hermes.

Unknown outcomes retain their original request or effect identities. Reconcile
them with `resume`, `renew`, or the exact same pinned approval decision. Do not
create a new claim or decision to conceal an uncertain terminal result.
