# Main Hub after Continue

Current design: Work, Settings and the global Hermes control. The separate
Conversations area was removed after review. Chat is a mode of the existing
Hermes dot, rather than a separate main-screen section.

## Routes and navigation

| Address | Responsibility |
| --- | --- |
| / | Welcome, Hermes installation and default-provider configuration. |
| /hub | Work summaries and the global HUD with Hermes input and floating Matrix chat. |
| /settings | Settings & configuration, including configured/available apps. |
| /settings?matrix=INSTANCE | The saved Matrix instance, account and room controls. |
| /settings?resource=KEY | An actual saved service instance. |
| /settings?component=ID | A saved instance, a choice among instances, or its catalog form. |

Continue retains the installed-software gate. The settings gear and configuration
prompts use client-side navigation. Query parameters resolve against existing
records and catalog entries; they never review or apply an action themselves.
Legacy /hub?matrix=INSTANCE links still forward to the matching Settings panel.

## Work

Service Management and Devgraph summaries use /api/hub. Unconfigured services
open the relevant catalog form; configured services open their saved details.
Launch links require fresh ready evidence and an allowed root service address.

The existing API does not supply aggregate work items. No requests, tasks,
counts or activity feeds are invented. Domain records retain their service
owners. The main screen does not read or refresh /api/matrix.

## HUD and floating Matrix

The dot remains a global collapsed control, independently of Hermes readiness.
Its hover/focus dial opens either the original Hermes quick input or a separate
floating Matrix panel. Matrix shows the connected account's rooms and spaces;
the dot stays visible while the panel is open and minimizes it.

See [the corrected HUD contract](hermes-chat-dial.md). The original Hermes
fading-response and page-context behavior remain. There is no Hermes transcript
or new history protocol. Existing Matrix controls remain in Settings.

## Theme and ownership

The cloud theme, white Work panel, monospace controls, settings gear and glass
input remain. There is no visible page title or navbar. Settings retains its
gallery and reviewed installation/configuration controls.

This UI change introduces no ontology or database migration. Existing setup,
connections, installation provenance, credentials and Matrix account/room
selections remain untouched. Native services retain their current running state.

The earlier [workspace verification record](main-hub-screen-verification-2026-11-24.md)
documents the preceding Conversations-and-Work iteration; it is historical
evidence, not the current layout.
