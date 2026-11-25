# Floating Matrix conversations

The user explicitly approved message history, sending and persistent encryption
keys for the Hub Matrix device. Chat remains inside the existing floating window;
the room/space list and Settings account controls keep their existing owners.
Hermes is independent. No room message is sent just by opening or reading chat.

## API and account binding

`POST /api/matrix/conversation` accepts the closed
`zenith.hub-matrix-conversation-action.v1` shape:

- `timeline`: `instanceId`, `roomId`.
- `send`: those fields plus `binding`, `message` (1–4,000 characters), and
  `transactionId` (`hub_` plus a UUID).

Both require the local operator origin and existing Matrix CSRF session. The
server resolves credentials privately, verifies whoami, device, joined membership
and permissions, and binds the response to the endpoint/account/device and exact
credential generation. The browser validates the same target before display.

`zenith.hub-matrix-conversation.v1` returns that binding, identity, encryption,
canSend, cryptoError, observation time and at most 50 projected messages. Redacted
messages become notices; text is rendered as text, never server-supplied HTML.
Room-list evidence and legacy setup probe flags do not authorize chat sending.

The selected timeline refreshes every five seconds only while open and visible.
Drafts are room/account scoped and memory-only. Send requires fresh evidence; the
server rechecks permission and encryption immediately before transmission. An
unknown result retains the exact ciphertext and Matrix transaction ID in a
private journal. Only explicit Retry repeats that same request. A successful
journal drops message content and retains the result ID and digest.

## Encryption and private storage

The maintained Element Matrix bot SDK supplies its Rust-backed Megolm client;
no bot membership/command loop is started. Native crypto runs in a supervised
child process. Its HTTP is proxied through the existing DNS-pinned, redirect-free
Hub transport with a narrow protocol allowlist. Native code is never browser-side.

`profiles/matrix-chat/native-crypto.json` pins crypto-nodejs 0.7.0 official release
assets by platform, bytes and SHA256. SDK 0.11.0-element.0 is exact in package-lock.
Node 24 or later is required.
`npm run matrix:prepare` explicitly verifies/installs the project-local binary
before use, including CI with npm install scripts disabled. Chat itself never
downloads a runtime or changes global software. Unsupported platforms fail closed.

Storage beneath the existing setup root:

- `credentials/matrix-clients/<identity>/identity.json`: exact endpoint/user/device
  binding and public device identity.
- The same directory's `crypto/`: persistent native SQLite room/device keys.
- `sync.json`: delivery cursor, acknowledged only after processing to-device keys.
- `owner.json`: one active worker per store; only a dead owner's lock is reclaimed.
- `credentials/matrix-send-journal/<identity>/`: explicit-send retry records.

Identity is hashed from endpoint/user/device. Directories are private (0700).
Existing session handles and account/device IDs remain unchanged. Opening an
externally imported client session does not clone its device: encrypted chat
requires a Hub-owned device. Missing stores with already-published keys fail
closed; the Hub never silently resets or replaces that identity. Operational
crypto files are not ontology objects and require no database schema migration.
Preserve these files with the private setup root; losing them may lose decryption
access. Do not publish them in repository artifacts, logs or screenshots.

## Limits

The current window reads recent messages, sends text, and shows undecryptable
history honestly. It does not implement older-page pagination, attachment uploads,
SAS/cross-signing verification, encrypted backup/recovery import or automatic
room-key migration from other clients. Older messages require their keys to have
reached this device. Unavailable keys never trigger a plaintext fallback. Matrix
conversation content is excluded from the Hermes MVP page-context bridge.

## Validation

Routine tests use disposable local protocol fixtures, never existing rooms.
They cover origin/credential isolation, membership, session replacement, encrypted
fail-closed behavior, idempotent and ambiguous sends, redactions/edits, text-only
rendering contracts, response identity, native binary integrity and page-context
exclusion. Native Mac arm64 tests encrypt/decrypt real Megolm, reopen the SQLite
store, retain device identity, reject a simultaneous owner, reject missing
keys and prove an idle crypto worker does not keep its owning Hub alive. Production, standalone and development HTTP checks exercise the actual
route, native worker, encrypted send/read and key continuity across restart.
Other pinned operating-system binaries have not been locally qualified.

Live Mac arm64 qualification: the existing Gabriel Hub session and encrypted
room opened in the floating window, native device keys initialized, and Send
became available for an unsent draft. Three older encrypted events remained
undecryptable because their room keys are not on this device. The existing
account and encrypted store reopened after a drive-unmount interruption; the
unsent browser draft survived. That draft was cleared. No live test message was
sent. Existing installations, profiles, connections and Matrix account/selection
bindings compare unchanged against the pre-change private baseline.

## Rooms and direct messages

The floating window separately lists **Direct messages** and **Rooms**, with the
existing spaces carousel filtering group rooms. Direct status comes from this
account's Matrix `m.direct` data; member count and application labels do not define
it. A failed account-data read is shown as unverified, never verified empty.
The protocol is the [Matrix Direct Messaging convention](https://spec.matrix.org/latest/client-server-api/#direct-messaging).

The **+** control opens three small forms in the same window: **New message**,
**Create room**, and **Join room**. New messages take a full Matrix user ID. New
group rooms take a name and up to 20 optional full Matrix IDs to invite; this
shortcut creates private, invite-only, encrypted rooms. Existing Settings controls
retain advanced room configuration. Joining accepts a full room ID or alias;
verified invitations also have a **Review join** action in the list.

All creation, joining and invitation effects use the existing persisted
`/api/matrix` review/apply contract. Review alone sends no invitation. The user
confirms the recipient or room before applying. No welcome/test message is sent.
New DMs reuse a verified existing encrypted DM where possible; otherwise
`createRoom` uses `is_direct`, the named invitee and explicit encryption. Unrelated
`m.direct` mappings are merged from a fresh read, never replaced by a one-room map.
Accepting a genuine direct invitation records its actual inviting user.

The controller retains a created room ID before subsequent account-data writes.
A failed mapping step stays partial and blocks unchecked replay. After the user
reconciles the retained outcome in Settings, a new review for the same recipient
resumes that exact retained room and its mapping instead of creating another.
Unknown network outcomes offer **Check result**, which reads retained operations
and never automatically repeats a creation. Existing room/account identifiers,
credentials and database owners remain unchanged; no ontology changes or schema
migration are required. Pending setup reviews remain accessible in Settings.

Qualification adds room/DM discovery and projection tests, closed and bounded
recipient inputs, mapping preservation/reuse, genuine incoming DM invitations,
alias joins, partial mapping recovery and existing account isolation. A real
native-crypto fixture has two different Matrix users/devices exchange encrypted
messages in both directions. Production, standalone and development HTTP checks
cover reviewed room invites, DM creation/reuse and encrypted message send/read.
All write qualification uses disposable fixtures; no live room, invitation or
message is created for these checks. Cross-client account-data writes use Matrix's
last-write-wins protocol; the immediate fresh merge cannot provide a server-side
compare-and-swap guarantee against another client writing at the same instant.

Independent discovery/account-data reads run concurrently. Slow refreshes recheck the account before publication, retain original per-room timestamps, and omit expired room, DM-map or invitation evidence. The UI permits a bounded longer refresh instead of reporting a premature timeout; stale evidence does not authorize new chat actions.
