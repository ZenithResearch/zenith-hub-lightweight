# Main Hub live verification — 2026-11-24

## Scope

Implemented /hub after Continue using the shared MainHub presentation committed
in zenith-ui-deployment at d2ff29c. Settings retains the existing gallery and
review/apply flows. There are no backend contract, ontology or data migrations.

## Automated checks

| Check | Result |
| --- | --- |
| Shared UI build and source provenance | Passed |
| Hub TypeScript | Passed |
| Hub imported source hashes | Passed |
| Hub controller and new main-view tests | 16 passed |
| Existing setup regression suite | 99 passed |
| Production Next build | Passed |

The production build still reports dynamic-filesystem tracing warnings in
existing application/setup code. These are outside the new presentation and
remain a packaging consideration.

## Live checks

- Restarted only the Hub web application through its existing database-first
  production launcher, keeping the setup root, repository and port unchanged.
  Retained a private rollback archive of the previous web build.
- Continue entered /hub from the welcome screen.
- Conversations showed the existing authenticated account and its one verified
  joined room; selection showed the encryption/client limitation before launch.
  No external room link was followed and no messages were sent.
- The settings gear opened /settings; a service configuration prompt opened
  its catalog form, and the Matrix prompt opened the saved instance.
  Closing the untouched form did not cause polling to reopen it.
- Returning to the main screen retained the selected conversation and an unsent
  Hermes draft. The verification draft was cleared and the existing input
  collapsed afterward. Only one global Hermes component was present.
- Legacy /hub?matrix=INSTANCE forwarded to the matching Settings panel.
- The current narrow viewport stacked Conversations and Work with the same
  cloud theme. Browser error logs were empty after the final build.
- Saved public setup/connection fields, account/device binding, selected
  space/room, repository ID, definition set and database schema matched the
  private pre-change baseline after final verification.
- The external Matrix homeserver on port 8008 retained its original process.
  Native services, credentials, rooms and service data were not restarted or
  reconfigured.

## Loading correction found during walkthrough

Initial rendering waited for a remote Matrix evidence refresh. The final build
renders saved connection summaries before that check completes, reuses fresh
evidence on entry and refreshes stale evidence in the background. Stale or failed
checks cannot produce active room links or a false empty list.

## Current limits

Conversations opens verified rooms in a compatible Matrix client. The Hub does
not yet provide an encrypted message timeline or sending. Work displays real
connection summaries and relevant configuration links; the existing APIs do not
yet supply an aggregate list of requests, cases, tasks or projects. No work data,
activity feed or counts are invented.
