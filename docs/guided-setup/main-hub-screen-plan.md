# Main Hub after Continue

Status: implemented. The shared presentation is owned by zenith-ui-deployment;
the Hub supplies data and navigation through its existing public APIs.

## Routes and configuration

| Address | Responsibility |
| --- | --- |
| / | Welcome, installed Hermes prerequisite and default-provider configuration. |
| /hub | Everyday workspace with Conversations and Work. |
| /settings | Settings & configuration, retaining the Apps & services gallery. |
| /settings?matrix=INSTANCE | Existing saved Matrix instance, account and room controls. |
| /settings?resource=KEY | Details of an actual saved service instance. |
| /settings?component=ID | A saved instance, a choice among multiple instances, or the catalog setup form. |

Continue retains its installed-software check. Legacy /hub?matrix=INSTANCE links
forward to Settings. Query parameters resolve against actual saved instances and
catalog entries; they cannot supply a new endpoint, review or apply configuration.
Prompts open the relevant Settings section, as requested. Setup forms remain
subject to the existing review/apply and CSRF checks.

## Conversations

The main page reads /api/matrix and invokes the existing observation refresh to
verify the retained account and room summaries. It distinguishes authenticated,
partial, stale, disabled, sign-in-required and unavailable evidence; a failed or
incomplete read is never described as a verified empty room list. Only current,
joined rooms with matching account, endpoint and device evidence receive actions.
Spaces are excluded from the conversation list. Invitation management stays in
Settings.

Selecting a room displays its verified name and topic. Selection is in-memory
UI state, retained during client-side Settings navigation. It does not change
the saved Matrix room selection, join rooms or send a message.

Open in Matrix client uses a Matrix room permalink. The Hub does not implement
an E2EE timeline or messaging client. That requires a separate client adapter,
including session/key ownership and encryption review.

## Work

Service Management and Devgraph cards use saved connection summaries from
/api/hub. Unconfigured services link to their catalog setup form; configured
instances link to their details. A launch link requires fresh ready evidence
and a safe root service address, consistent with the existing endpoint policy.

These are connection summaries, not an aggregate work-item list. The existing
Hub APIs do not expose requests, cases, tasks or projects. No items, counts,
health claims or feeds are fabricated. A future read adapter must preserve each
service's ownership and stable object references. Process Runtime and Frank
remain available in Settings.

## Theme, navigation and Hermes

The screen retains the cloud background, white panels and monospace controls.
Conversations and Work are side by side on desktop and stack on narrow screens.
The settings gear has an accessible name. No large visible page title or navbar
is added. Settings has a return-to-Hub link.

One existing GlobalHermesChat remains in the root layout. Client-side links
preserve its state and the selected conversation without storing credentials or
drafts in a new browser store. No guide profile or chat CTA is introduced. The
approved MVP page-context bridge is unchanged.

## Ownership, refresh and migration

No backend or persisted contract changes are needed. The application database,
setup instances, native installations, session/credential bindings and room
selections keep their owners and identifiers. No migration or resource graph
index is introduced.

Observation refresh reads the existing Matrix account and rooms and updates
their local evidence only; it cannot log in, create/join rooms, send, install or
configure. Saved summaries render before any remote verification finishes. Fresh evidence
is reused on entry; checks refresh expired evidence, on explicit refresh and while
visible, with bounded
requests and freshness validation. Neither API reachability nor a retained view
alone establishes a valid account.

## Validation

Fixture tests cover account/device/endpoint mismatches, expired and stale
evidence, incomplete room lists, credential exclusion, safe service addresses,
configuration intent resolution, unavailable sources and preserved input
snapshots. Existing Hub controller checks still cover reviewed actions, retained
connections and private data. Shared UI and consumer builds verify the additive
presentation contract and source pins.

Live verification must check Continue, the main screen, targeted Settings and
return navigation, a retained conversation selection, the singleton Hermes input
and unchanged saved setup/account bindings. It must not send messages or mutate
rooms merely to verify the UI.
