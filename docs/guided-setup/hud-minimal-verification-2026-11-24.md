# Minimal HUD dial verification — 2026-11-24

The HUD keeps its existing glass circle. Hover/focus reveals a fine arc, an inbox
glyph and small colored Hermes receiver dots. Names are available through
native tooltips and accessible labels. Only actual configured Hermes receivers
are listed; the local setup currently contains one. This does not create or
configure Hermes profiles. The existing default receiver remains unchanged.

## Ownership and compatibility

- Shared presentation is committed in zenith-ui-deployment before import into the
  Hub, with exact file hashes pinned in profiles/source-provenance.json.
- Optional quick-target props preserve older component callers. The fallback dot
  still opens the existing Hermes input when no target list is supplied.
- Choosing a dot uses the existing instanceId chat contract. It is local UI state;
  no setup, backend, credential, ontology or application-database schema changes.
- Before sending, the Hub checks that the chosen receiver still exists and is
  available. A removed or disabled receiver cannot silently select another one.
- Matrix stays independent of Hermes. Hover opens a preview without taking
  focus; a short leave grace period allows transfer into its floating panel.
  Explicit activation or interaction pins it. The center dot minimizes it.

## Automated checks

- Shared UI build/TypeScript and source-provenance checks passed.
- Matrix spaces relationship fixture passed, including nested spaces and cycles.
- Three Hermes response-timing checks passed.
- 46 Hub fixture checks passed, including receiver routing/disappearance,
  account/device/endpoint isolation, incomplete Matrix checks and onboarding.
- Hub TypeScript, source-provenance and production build passed.

## Live verification and limits

Browser checks cover the minimal unlabeled controls, existing Hermes input,
Matrix hover without focus capture, pointer transfer, dismiss, explicit pin,
keyboard activation and center-dot minimize. No inference request or Matrix
message was sent. Additional profile routing is fixture-tested; there is only
one configured Hermes receiver in the live setup.

The existing native Matrix homeserver on port 8008 intermittently timed out,
then recovered without a restart or configuration change. Final live checks
showed the existing joined encrypted room, the spaces carousel with no joined
spaces, local room detail selection and retained selection after minimize/reopen.
Hover dismissal was also verified with the center dot already focused, and
explicit activation stayed pinned after clicking outside the panel. An incomplete
account check now has a distinct unavailable message rather than claiming an
identity mismatch. No encrypted timeline/client has been introduced. Nested
space filtering remains fixture-tested because this live account has no spaces.

The pre-change comparison confirmed unchanged installation, setup, connection,
Matrix account/session-reference and saved room/space selection bindings, plus
the same database identity and schema. Observation refreshes retain their
existing owner. Private baseline and backup files are not committed.
