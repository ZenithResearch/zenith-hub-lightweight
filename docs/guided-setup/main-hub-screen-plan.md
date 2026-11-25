# Main Hub after Continue — review plan

Status: proposal for review. The Settings & configuration page is implemented;
the new main Hub screen is not part of this change.

## Page responsibilities and navigation

| Address | Responsibility |
| --- | --- |
| / | Welcome, Hermes installation prerequisite and on-page default-provider configuration. |
| /hub | Planned everyday workspace after Continue. During this transition it keeps rendering the existing settings gallery. |
| /settings | Canonical Settings & configuration page; Apps & services is its current section. |
| /settings?matrix=INSTANCE | Existing Matrix configuration, account and room-management flow for that instance. |

Continue keeps its existing installed-software check and /hub destination.
The new main screen must remain usable when optional providers or services are
not configured. Opening it must not install software, start services, create
profiles, change accounts or grant access.

Existing /hub bookmarks and Matrix query links keep working during this change.
When /hub becomes the main workspace, preserve old /hub?matrix=INSTANCE links
by forwarding that explicit configuration intent to /settings.

## Recommended first screen

Keep the blue cloud background, compact white panels, monospace controls and
existing glass Hermes input. Use a small accessible settings gear rather than a
large page title or navigation bar. Keep the Hermes input initially collapsed.

Suggested desktop composition:

    [Current account / connection, when verified]              [Settings gear]

    +------------------------------+--------------------------------------+
    | Conversations                | Work                                 |
    | Verified Matrix rooms        | Requests, cases and linked work      |
    | Select or open a conversation| From configured services             |
    | Clear connection/empty state | Clear connection/empty state         |
    +------------------------------+--------------------------------------+

                                                    [Existing Hermes circle]

On narrow screens, stack the two areas. Keep settings reachable and the Hermes
input clear of content and form controls.

### Conversations

Use the Hub's existing Matrix account and verified room summaries. Distinguish
an authenticated account from API reachability and distinguish unverified room
access from an empty room list. Preserve a visible account identity so the user
knows which account they are using.

The first version can launch a room in a compatible Matrix client. The current
Hub integration does not provide an E2EE-capable conversation timeline; planning
a room list must not imply that it can decrypt, display or send encrypted chat.
An in-Hub conversation view needs a separately reviewed client adapter.

Room selection may save an existing verified selection through the current
reviewed API. Joining, inviting, creating rooms or sending a message remains an
explicit user action. Opening the main screen performs no such actions.

### Work

Present work from configured Service Management and Devgraph connections,
starting with read-only summaries and links to the owning service. Identify the
source of each item and use its stable object reference. Do not turn the Hub
database into a duplicate owner of requests, contacts, tasks or projects.

Until an appropriate connection exists, show a short explanation and a link to
its settings. Do not invent work, counts, activity feeds or a successful health
state. Process Runtime and Frank remain service capabilities; installation and
instance controls stay in Settings & configuration.

### Hermes and other inputs

Keep the existing global Hermes component and its configured backend. Do not
add another chat CTA or create a guide profile. Preserve draft and response
behavior during in-app navigation.

The approved MVP page-context bridge remains as implemented. A future general
input surface should distinguish receiver, message, attached context and
implementation binding, allowing agent and non-agent receivers. It should not
be introduced by changing the meaning of the existing Hermes input in this UI
slice.

## Ownership and preservation

- Reuse the existing application database, setup instances, catalog and opaque
  credential/session bindings. No migration or new storage namespace is needed
  for this page change.
- Read the existing public /api/hub and /api/matrix contracts for connection
  summaries. A fresh observation may update verification evidence; it must not
  reconfigure or take ownership of the service.
- Keep credentials out of page props, URLs, browser storage, exported plans and
  ontology objects. Preserve Matrix user identity, device binding and selections.
- Leave the current resource-graph rollback in place. This screen needs no new
  resource graph index, ontology class or generic index-creation interface.
- Preserve the cloud scene, reduced-motion behavior, keyboard focus and compact
  gallery. Settings continues to use reviewed installation/configuration actions.

## Build sequence after design review

1. Review the primary layout and the two empty states. Decide whether the first
   main screen should emphasize Conversations or Work.
2. Finalize the main-screen presentation in zenith-ui-deployment, with explicit
   loading, authenticated, stale, disconnected and unavailable states.
3. Add read-only view adapters over the existing connection contracts. Reuse
   real service summaries; do not add application-wide indexing.
4. Replace only the /hub compatibility view with the approved main screen.
   Keep /settings as-is and provide a settings gear and a return-to-Hub link.
   Preserve legacy Matrix deep links.
5. Verify Continue, settings navigation and return, retained Hermes input state,
   Gabriel's existing Matrix binding and configured instances. Test with fixtures
   for disconnected services and unsupported encrypted conversations. Exercise
   the real installation using read-only checks; do not send a test message as a
   side effect of navigation.

## Three guided review checks

1. Enter after Continue: can you tell what you can do now, without seeing the
   installation catalog?
2. Open a conversation or a work item: is its account/service owner clear, and is
   an unsupported action explained before you attempt it?
3. Open Settings and return: are your account, selected room, work context and
   Hermes draft retained?

The first two decisions to settle are the primary area (Conversations or Work)
and whether the initial conversation action should open an external Matrix
client or wait for an in-Hub client adapter.
