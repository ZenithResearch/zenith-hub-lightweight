# Hermes Quick / Chat dial

The dot stays collapsed on first load. Hover or keyboard focus reveals a radial
Quick / Chat selector. Arrow keys enter the choices; Escape dismisses them.
Touch reveals choices on the first tap. Clicking the dot normally opens the
current mode; the input's dot minimizes it.

Quick keeps the existing 80-words-per-minute reply timer, fade and loading border.
Chat uses the same input, backend and draft with a scrollable glass transcript
whose messages do not fade. Mode changes and client-side navigation keep that
state. The existing instance identity key resets the widget if the receiver changes.

The local transcript is bounded to 40 exchanges and 120,000 characters in browser
memory. Reloading clears that local transcript; it does not change any history
maintained by Hermes. No new profile, database collection or browser persistence
is introduced.

## Additive chat-v1 request

Existing message-only requests are unchanged. Chat mode may also send history:
complete alternating user/assistant exchanges, beginning with user and ending
with assistant. The limit is 12 messages and 12,000 characters. Every message has
exactly role and content. System/developer/tool roles, extra fields, empty content,
incomplete pairs and oversized history are rejected before inference. The existing
64 KiB HTTP request limit remains; the browser drops whole oldest exchanges if
multibyte context would exceed that envelope, preserving the current input.

Only successful completed exchanges enter follow-up context. Failed and pending
turns remain visible locally without being replayed as successful responses.
The previously approved page-context bridge appends page data to the current
message only. Prior page captures are not retained in the browser transcript.

The trusted system instructions stay first, followed by history and the current
user message. CSRF, receiver/credential-generation checks, model configuration,
no-tools restrictions and native service ownership are unchanged. History is not
stored in setup objects.

## Main screen

Work and Settings remain on /hub with the cloud theme. The separate Conversations
area is removed and the main screen does not fetch or refresh Matrix. Saved
Matrix account and room controls remain available in /settings.
