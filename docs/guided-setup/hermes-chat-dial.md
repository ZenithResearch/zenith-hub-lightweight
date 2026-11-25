# HUD dial: Hermes input and Matrix

The HUD dot remains visible, including while Hermes is stopped or connection
discovery is pending. Hover or keyboard focus reveals a connected glass crescent around the circle, with colored Hermes
receiver dots on its rail and an inbox glyph inside its top segment. Labels live in tooltips and accessible
names, with no labeled pills. Only configured receivers appear; no profiles are
created by this view. The existing default remains selected until a dot is chosen.
The dot opens the original Hermes quick input; its input dot minimizes it.
Hovering the inbox previews the floating rooms/spaces panel without taking focus.
The radial menu has a 140 ms leave grace period for crossing small gaps, and a
280 ms preview grace period lets the pointer cross into the panel. Keyboard
arrows cycle the available targets; Home/End select the first/last, and Escape
dismisses the menu and returns focus to the circle. The preview closes after leaving both regions.
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
compact Messenger-inspired window uses blue glass chrome, a framed account
avatar and a light room list. The account status light describes connection
verification, not a person’s online presence. Room avatars and encryption marks
come from the existing room model; no unread counts or presence are inferred.
The panel separately lists account-native direct messages and group rooms, with spaces in a horizontal carousel above the room list. The + control opens reviewed new-message, create-room and join flows inside the same window; verified invitations can be accepted there too. Selecting a
space filters the rooms below it through verified
m.space.child relationships, including nested spaces, and keeps local selection across navigation and
minimizing. Account/device identities scope that selection. Matrix configuration
links open the matching Settings section. No selection is written merely by
browsing the panel.

Only while open, the panel reads the existing /api/matrix snapshot and refreshes
stale observation evidence through the existing authenticated, CSRF-protected
refresh action. Selecting a room opens its recent timeline and message input in
this same window. Closed panels stop polling. Credentials remain server-side.

The separately authorized conversation client uses the saved Hub account and a
persistent encryption store for its own Matrix device. Reading does not send a
room message. Messages are sent only by Send (or Enter in the composer); drafts
remain in memory across minimizing and navigation. Ambiguous delivery offers an
explicit retry of the same Matrix transaction rather than sending a new copy.
Older encrypted messages may remain unreadable until this device has their room
keys. The panel never disables encryption, joins rooms automatically or replaces
another client's device keys. Matrix text is excluded from Hermes page context.
See [Matrix conversations](matrix-conversations.md) for storage and qualification.

No ontology or application-database migration is required. Existing setup,
connections, credentials, Matrix accounts, room memberships and saved selections
retain their owners and identifiers.
