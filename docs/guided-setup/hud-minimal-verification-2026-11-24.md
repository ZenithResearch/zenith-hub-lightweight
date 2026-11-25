# Radial HUD menu verification — 2026-11-24

The menu was rebuilt as a connected glass crescent around the existing HUD
circle. A dedicated top segment opens Matrix inbox; colored receiver dots sit
on the curved rail. Labels remain in tooltips and accessible names. Existing
configured receivers supply the dots; the live setup contains one. The menu
creates no profiles and does not change the default backend.

## Contract and ownership

The shared component retains its existing props and callbacks. Its pointer,
keyboard and touch menu state is newly implemented. Pointer leave has a 140 ms
grace period for crossing radial gaps; Matrix preview transfer retains the
application's 280 ms grace. Arrow keys cycle targets, Home/End select endpoints,
and Escape dismisses and returns focus after menu state settles. Initial hover
is restored if receiver discovery mounts the control beneath the pointer.

The shared UI is committed before import, with exact file hashes pinned in
profiles/source-provenance.json. The Hub still owns receiver identity, Matrix
account verification, preview/pinned state and navigation. The same application
database and setup remain in use; no stored or HTTP contract changed.

## Validation

- Shared UI build/TypeScript and authored-source hashes passed.
- Matrix nested-space/cycle fixture and three response-timing checks passed.
- 28 focused Hub fixture checks passed, including receiver disappearance and
  Matrix account/device/endpoint isolation.
- Hub TypeScript, imported-source hashes and production build passed.
- Browser checks cover the connected crescent, real receiver input, Matrix hover
  without focus capture, transfer into the panel, pinning, minimizing, keyboard
  activation and Escape dismissal. No inference or Matrix message is sent.

The existing Matrix joined room is visible beneath its spaces carousel. This
account has no joined spaces, so nested-space filtering remains fixture-tested.
The Hermes receiver is stopped in the existing setup; its input remains
available while sending stays disabled. Additional receiver routing is covered
by fixtures, not multiple live profiles. Encrypted timeline reading/sending is
outside this rooms/spaces surface and still requires a capable Matrix client.

The preservation comparison verifies unchanged installation, configuration,
connection, Matrix account/session-reference and saved-selection bindings, plus
the same database identity and schema. The native server on port 8008 was left
unchanged. Private baseline and backup files are not committed.
