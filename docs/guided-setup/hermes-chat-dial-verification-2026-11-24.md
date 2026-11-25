# Hermes dial verification — 2026-11-24

## Automated checks

- Shared UI build and provenance check passed. Three chat-history checks cover
  successful/failed/pending exchanges, whole-pair retention and transcript bounds.
  The three existing reply-timing checks still pass.
- Hub TypeScript and production build passed. Existing dynamic-filesystem tracing
  warnings remain outside this interaction change.
- The existing setup regression suite passed 102 checks, including the new mock
  Hermes follow-up integration and history rejection tests.
- After the final request-budget change, 23 focused Hub/message checks passed,
  including an additional multibyte request-envelope case.
- Imported shared UI hashes match the committed sources at 5812801.
- Message-only v1 requests remain accepted. Fixture inference confirms the trusted
  system message stays first, completed history follows, current input stays last,
  no tools are exposed and prior turn text is absent from persisted setup.

## Browser checks

- Verified /hub contains Work and the settings gear without a Conversations area
  or the retired workspace identity label.
- Verified the collapsed dot reveals its Quick / Chat dial on pointer hover and
  keyboard focus; keyboard navigation activates Chat.
- Verified Chat opens a readable glass panel, Quick returns to the existing
  input, and switching modes preserves an unsent draft.
- Verified client-side Settings navigation preserves Chat mode and the draft.
  Cleared the temporary verification draft and restored the collapsed Quick
  control afterward. No inference request or Matrix message was sent.
- Existing Settings still shows the saved Matrix account as authenticated.

## Preservation and qualification limits

A private baseline read through the application database API was compared after
deployment. Saved installations, source/configuration/profile bindings, connection
records, Matrix account/device/selection and database identity matched.

Only the Hub web application was restarted through its normal database-first
launcher. No migration, native service start, account change or room operation
was performed. The original external Matrix homeserver process was left alone.

The saved Hermes instance is currently stopped. The UI correctly disables Send
and explains that state. Real-provider multi-turn inference was not qualified;
the inference path and bounded history were exercised against the isolated mock
Hermes server. Touch handling was implemented but not tested on a physical touch
device. The local transcript is browser memory, not durable chat storage.
