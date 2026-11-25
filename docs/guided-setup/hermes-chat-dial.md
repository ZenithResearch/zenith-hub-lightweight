# HUD dial: Hermes input and Matrix

The HUD dot remains visible, including while Hermes is stopped or connection
discovery is pending. Hover or keyboard focus reveals Hermes and Matrix choices.
The dot opens the original Hermes quick input; its input dot minimizes it.
Selecting Matrix collapses the Hermes input and opens a separate floating panel,
leaving the dot in place. While Matrix is open, the dot minimizes that panel.

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
