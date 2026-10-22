# Prepare finite provider authority in Process Workspace

Status: source candidate. The current published workspace bundle does not yet contain the required Wallet build, so these commands must not be described as installed or released.

The generic Process Workspace remains the only root. Provider preparation is explicit, runs only while Runtime and Service are stopped, preserves the existing workspace identity and keeps run admission closed. It creates two independent authority surfaces:

- a separate `application=service` identity with twelve fixed Service lifecycle/query permissions over the local `requests/` and `cases/` namespaces;
- a successor Runtime policy with twenty-two fixed permissions for one exact Frank Actor and one exact Run, while retaining the five authoring/catalog permissions.

Neither action configures a queue, stores a Vercel credential, publishes a workflow, registers Frank, starts a service, enables Runtime admission or enables a provider. Those steps require the reviewed provider bundle and their own evidence.

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

## Review one Actor/Run Runtime authority

The Run identity must come from the exact retained Service lifecycle command; do not invent or reuse it after an uncertain or terminal run.

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-authority-prepare \
  --root "$ROOT" --actor-id frank-anima --run-id EXACT_RETAINED_RUN_ID
```

Review the same identity, predecessor receipt, exact Actor, exact Run, finite window, permission count `22` and `plan_sha256`, then apply:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-authority \
  --root "$ROOT" --selection-sha256 REVIEWED_PLAN_SHA256
```

An interrupted native transition stays held. Use `workspace-provider-authority-resume` only with the exact retained plan digest. Ordinary setup or renewal must never replace retained recovery state.

## Run one bounded local worker action

The source candidate composes the Service worker into four explicit, one-item
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

After Service has retained the exact Case and Run identity, select finite Runtime
authority for that Run, start the workspace Runtime, and advance one lifecycle
command:

```bash
"$PYTHON" -I -S -B "$ROOT/control.py" workspace-provider-advance-once --root "$ROOT"
```

Use `workspace-provider-resume-once` only for a retained unknown lifecycle
outcome. Lifecycle dispatch requires the active Service authority, the active
exact Actor/Run Runtime authority, the controller-owned Runtime listener, and the
fixed `zenith.anima.brand-package` process version and compilation digest. The
requester-policy option is rejected for lifecycle actions.

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
