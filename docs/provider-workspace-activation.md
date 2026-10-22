# Prepare finite provider authority in Process Workspace

Status: source candidate. The current published workspace bundle does not yet contain the required Wallet build, so these commands must not be described as installed or released.

The generic Process Workspace remains the only root. Provider preparation is explicit, runs only while Runtime and Service are stopped, preserves the existing workspace identity and keeps run admission closed. It creates two independent authority surfaces:

- a separate `application=service` identity with twelve fixed Service lifecycle/query permissions over the local `requests/` and `cases/` namespaces;
- a successor Runtime policy with twenty-three fixed permissions for one exact Service handoff, its derived Run and one exact Frank Actor, while retaining the five authoring/catalog permissions.

Neither action configures a queue, stores a Vercel credential, publishes a workflow, registers Frank, starts a service, enables Runtime admission or enables a provider. Those steps require the reviewed provider bundle and their own evidence.

## Pull one encrypted request

The provider-capable bundle may add one release-pinned
`secs-provider-intake-v1` native role. The current published workspace bundle
does not contain that role, so pull remains unavailable there. A candidate with
the role can consume at most one delivery using a closed operator-owned route:

```json
{"consumer_group":"zenith-provider-mac","lease_seconds":300,"region":"sfo1","schema":"hub.provider-pull.v1","topic":"zenith-intake-v1"}
```

Store those exact bytes at `config/provider-pull.json` with mode `0600`, and
store the Vercel OIDC token separately at
`config/provider-vercel-oidc-token`, also with mode `0600`. The token is passed
to Service Management by file path and read into the official SDK in memory;
it is never placed in the browser request, argv or inherited environment.

Review the public route digest, then run:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-pull-once \
  --root "$ROOT" --provider-config-sha256 EXACT_ROUTE_SHA256
```

The fixed command uses the installed opener digest, fixed intake database and a
batch limit of one. Queue acknowledgement still happens only after durable
local ingestion. Pulling does not create a ServiceRequest or Case and requires
no Service or Runtime authority.

## Review and create Service authority

```bash
ROOT="$HOME/Library/Application Support/Zenith/Process-Workspace"
PYTHON="$ROOT/venv/bin/python"

"$PYTHON" -I -S -B "$ROOT/control.py" workspace-stop --root "$ROOT"
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-service-prepare --root "$ROOT"
```

Review the returned root, generation `1`, permission count `12`, finite window and `plan_sha256`. Apply only those exact bytes:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-service-setup \
  --root "$ROOT" --selection-sha256 REVIEWED_PLAN_SHA256
```

The controller verifies the native `COMPLETE.json`, its three configuration digests and the exact first-generation scope before publishing `config/provider-service-selection.json`. If native creation completed but its response was lost, rerunning the same apply selects the retained exact receipt without invoking native creation again.

## Preview and review one Actor/Run Runtime authority

After admission, preview the exact future identity without mutating Service or
Runtime and without issuing authority:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-activation-once --root "$ROOT"
```

The result supplies `activation.handoff_id` and `activation.run_id`. The Run
must equal `handoff-` plus the first 48 hex characters of the 64-hex handoff ID.
Both are deterministically derived from the retained request's future Case and
immutable plan revision. The later approved lifecycle result must match them.
Do not invent or reuse either identity after an uncertain or terminal run.

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-authority-prepare \
  --root "$ROOT" --actor-id frank-anima \
  --handoff-id EXACT_RETAINED_HANDOFF_ID --run-id EXACT_DERIVED_RUN_ID
```

Review the same identity, predecessor receipt, exact Actor, handoff, derived Run,
finite window, permission count `23` and `plan_sha256`, then apply:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-authority \
  --root "$ROOT" --selection-sha256 REVIEWED_PLAN_SHA256
```

An interrupted native transition stays held. Use `workspace-provider-authority-resume` only with the exact retained plan digest. Ordinary setup or renewal must never replace retained recovery state.

## Run one bounded local worker action

The source candidate composes the Service worker into explicit, one-item
actions. It does not add a scheduler or poll the remote queue. Admission uses the
fixed local intake and Service databases plus an operator-reviewed requester
policy. Supply the digest of those exact policy bytes:

```bash
POLICY="$ROOT/config/provider-requester-policy.json"
POLICY_SHA256="$(shasum -a 256 "$POLICY" | awk '{print $1}')"
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-admit-once \
  --root "$ROOT" --provider-policy-sha256 "$POLICY_SHA256"
```

If native admission has an unknown retained outcome, use
`workspace-provider-resume-admission-once` with the same policy digest. Each
action processes at most one retained intake row.

After preview and authority selection, start the workspace Runtime and advance
one lifecycle command:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-advance-once --root "$ROOT"
```

Use `workspace-provider-resume-once` only for a retained unknown lifecycle
outcome. Lifecycle dispatch requires the active Service authority, the active
exact Actor/Run Runtime authority, the controller-owned Runtime listener, and the
fixed `zenith.anima.brand-package` process version and compilation digest. The
requester-policy option is rejected for lifecycle actions.

Lifecycle artifact writes occur while new-Run admission remains closed. Once
the lifecycle returns `approved` with the same activation identity, stop the
workspace, prepare and review the exact admission transition, then apply it:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-admission-open-prepare --root "$ROOT"
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-admission-apply \
  --root "$ROOT" --selection-sha256 REVIEWED_ADMISSION_PLAN_SHA256
```

Start Runtime and deliver only the retained exact handoff selected by the live
authority receipt:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-deliver-handoff-once --root "$ROOT"
```

After Runtime acknowledges the handoff, stop the workspace and close admission.
Because this replaces the retained admission proposal, the close preparation
also pins the prior proposal bytes:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-admission-close-prepare \
  --root "$ROOT" --selection-sha256 PREVIOUS_ADMISSION_PLAN_SHA256
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-admission-apply \
  --root "$ROOT" --selection-sha256 REVIEWED_CLOSE_PLAN_SHA256
```

Admission opens only for the exact selected authority composition. Lifecycle
does not require it; exact delivery does. The controller never derives a
handoff from browser input and never scans forward by choosing a different
pending outbox record.

Remote Vercel Queue pull/opening, requester-policy publication, background
supervision and public request/status delivery are still separate release and
deployment work.

## Status meaning

`workspace-status` reports Service and Runtime provider authority separately.
`configured_native_unqualified` means the exact local native receipts and files
validate; it is not release, installation, queue, execution or production
evidence. `provider_enabled` and `execution_enabled` remain false. A successful
one-shot result proves only that bounded command; it does not prove remote intake,
background supervision, Frank registration or complete service delivery.
