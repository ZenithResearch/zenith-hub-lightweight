# Floating Matrix HUD verification — 2026-11-24

## Current behavior

The global dot stays visible independently of Hermes discovery/readiness. Its
hover/focus dial opens either the original Hermes quick input or a separate
floating Matrix panel. The Matrix panel uses the existing saved account and
does not depend on Hermes being running.

Spaces are arranged in a horizontal carousel above Rooms. Selecting a space
filters the room list using real m.space.child edges, including nested spaces.
All rooms also remains available. Overflow controls, arrow-key navigation and
reduced-motion scrolling are implemented. Local selection is scoped by instance,
user and device; it does not change saved membership or room selections.

The user chose the floating rooms/spaces UI first. The panel does not provide an
encrypted timeline or send composer. Room details link into a capable Matrix
client. The accidentally introduced Hermes transcript/history API was reverted.

## Validation

- Shared UI TypeScript/build and source provenance passed.
- The shared space-filter fixture covers nested spaces, cycles, missing children
  and the all-rooms view. The existing three reply-timing tests pass.
- Forty-three focused Hub, Matrix-view and restored Hermes setup/message tests
  passed. They cover stale/disabled/wrong-account evidence, credential exclusion,
  device-scoped selection, malformed snapshots and preserved v1 messages.
- The Hub production build and imported source hash checks passed. Existing
  dynamic-filesystem tracing warnings remain a packaging consideration.
- Browser verification showed the persistent dot, keyboard dial activation,
  a floating Matrix panel, the Spaces strip above Rooms and the actual saved
  account's joined room. The current account has one joined room and no joined
  spaces; no synthetic spaces were added. Multiple-space filtering is covered
  by fixtures, rather than claimed as a live multiple-space qualification.
- Opening the panel now requests a fresh account/room check immediately. Polling
  stops when it closes and refreshes on return to the visible page.
- No Matrix room link was followed, no message was sent, and no account, room,
  membership, credential or native service operation was performed.

## Preservation

Saved installation/source/configuration/profile bindings, connections, Matrix
account/device/selection and repository identity were compared with a private
pre-change baseline through the application database API. They matched after
deployment. The original homeserver on port 8008 was left running. Only the Hub
web process was restarted through its normal database-first launcher.

No ontology or database migration was introduced. A private previous web-build
archive was retained for rollback.
