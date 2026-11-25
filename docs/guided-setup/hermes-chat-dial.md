# HUD dial: Hermes input and Matrix

The HUD dot remains visible, including while Hermes is stopped or connection
discovery is pending. Hover or keyboard focus reveals a fine arc, small colored
Hermes receiver dots and an inbox glyph. Labels live in tooltips and accessible
names, with no labeled pills. Only configured receivers appear; no profiles are
created by this view. The existing default remains selected until a dot is chosen.
The dot opens the original Hermes quick input; its input dot minimizes it.
Hovering the inbox previews the floating rooms/spaces panel without taking focus.
The options sit a few pixels from the dot, and a 280 ms grace period lets the
pointer cross into the panel. The preview closes after leaving both regions.
Clicking the inbox or interacting with the panel pins it open until minimized.
Touch and keyboard activation also open the pinned view. Selecting Matrix from
the expanded Hermes input preserves its draft and collapses that input.
The dot remains in place and minimizes Matrix while it is open.

Choosing a receiver dot opens its Hermes quick input. Receiver identity is checked
again before each send; a missing or disabled receiver cannot silently fall back
to a different profile. Receiver selection is local UI state, and does not change
the installation, active backend or stored configuration.

Hermes retains its original transient reply timer, loading border, message-only
API and approved page-context bridge. There is no Hermes transcript mode or
follow-up-history field. The mistakenly added history implementation was removed.

Matrix uses its own saved account, independently of Hermes availability. Its
panel shows spaces in a horizontal carousel above the room list. Selecting a
space filters the rooms below it through verified
m.space.child relationships, including nested spaces, and keeps local selection across navigation and
minimizing. Account/device identities scope that selection. Matrix configuration
links open the matching Settings section. No selection is written merely by
browsing the panel.

Only while open, the panel reads the existing /api/matrix snapshot and refreshes
stale observation evidence through its existing authenticated, CSRF-protected
refresh action. It does not create sessions, join/create rooms, send messages or
manage native services. Closed panels stop polling. Credentials remain server-side.

The existing connector does not supply a message timeline or E2EE client. The
panel makes that limitation explicit and offers a Matrix client room link,
rather than exposing a plaintext composer in encrypted rooms. Building native
message reading/sending requires a separately implemented client capability.

No ontology or application-database migration is required. Existing setup,
connections, credentials, Matrix accounts, room memberships and saved selections
retain their owners and identifiers.
