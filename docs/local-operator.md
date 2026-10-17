# Local operator boundary v1

The browser talks only to the same-origin Next server at `/api/deployer`. That
server runs one copied, pinned Mac controller with a fixed Python interpreter,
fixed action allowlist, fixed installation root, fixed release and fixed ports.
The controller owns installation validation and launchd lifecycle. It does not own
Service requests/cases, Runtime execution state, native identity custody or grants.

## Configuration

The launcher reads `.env.operator.local` on the operator's machine. The browser
cannot change it. `ZENITH_PROCESS_ROOT`, `ZENITH_PROCESS_BUNDLE`,
`ZENITH_PROCESS_PYTHON`, `ZENITH_RUNTIME_PORT`, `ZENITH_SERVICE_PORT` and
`ZENITH_OPERATOR_PORT` are the supported settings. Default component ports are
8092 and 8091; the UI uses 4208. Set alternate ports for isolated installations.
The repository must remain in its checkout layout, with the `profiles` directory
available at runtime. The copied controller's bundle-building subcommand belongs
to its upstream layout; this UI uses only install/status/doctor/start/stop.

The standard `dev`/`start` commands do not enable the bridge. The `operator` and
`operator:start` launchers bind numeric loopback and explicitly enable it. A
remote hosted frontend cannot reach into a Mac or execute arbitrary commands.

## Additive wire contract

GET returns `zenith.deployer.v1`: either a disabled explanation or an observed
local snapshot, allowed actions and an in-memory anti-CSRF token. Component
liveness, readiness and managed ownership are separate nullable observations.
No command output, subprocess stderr, credential or private key is returned.
Responses use `no-store`; public disabled snapshots contain no host paths.

POST accepts exactly one of these shapes, bounded to 2,048 bytes and a two-second
body deadline:

```json
{"schema":"zenith.deployer-action.v1","operation":"plan","action":"doctor"}
```

```json
{"schema":"zenith.deployer-action.v1","operation":"apply","plan_id":"opaque-id"}
```

Action is one of install/doctor/start/stop. No additional fields are admitted.
A plan expires after 60 seconds, is consumed on apply (including a failed apply),
and binds destination device/inode/existence plus release manifest digest. The
exact pinned profile is checked again. At most eight plans are retained per
server process. Server restart invalidates reviews and CSRF tokens. A second
apply is rejected while an operation runs. If the browser loses the response,
refresh status and run doctor before deciding whether another action is needed;
there is no automatic retry of installation or start.

Every local request requires the exact configured HTTP Host and effective URL
origin. Next development may internally spell the same-port numeric-loopback
origin as `localhost`; the route normalizes only that exact internal spelling,
checks the numeric HTTP Host, and then rechecks the effective origin in the
controller. Arbitrary origins, schemes, ports and forwarded headers are rejected
or ignored. Writes additionally require exact Origin, JSON content type,
same-origin fetch metadata when present, and `X-Zenith-CSRF`. No CORS allowance
is emitted. Admission occurs before reading POST bodies.

Child processes use argument arrays, never a shell, with isolated Python flags,
a minimal environment, bounded output and timeouts. An owned process group is killed and its absence is confirmed before releasing a failed operation. Unconfirmed cleanup blocks further commands and status subprocesses until operator recovery. Detailed failures remain
in local component logs; the browser receives generic codes. This is an owner
operation surface: local processes already running as that owner remain within
the owner trust boundary. It is not a multi-user remote deployment service.

## Compatibility and evidence

No Service/Runtime business API or schema changes are made. The unchanged Mac
controller's source and release profile hashes are recorded in source provenance;
its upstream MIT notice is retained. The UI component is from a prior committed
ZenithUI revision. Producer tests exercise closed requests and hostile origins,
review expiry/replay, changed destinations/releases, concurrency and bounded
HTTP reads. Actual browser acceptance uses a separate temporary root and ports
18291/18292, installs the offline bundle and starts/stops the owned jobs.

Removing the controller, an unsupported Mac, missing Python, corrupt installation,
wrong release, or failed subprocess must fail closed. An unavailable observation
never becomes a healthy/complete milestone. No native identities, roles, keys,
grants or provider credentials are created by this UI.
