# Public baseline scope

The owner approved preserving the private histories and publishing sanitized new
repositories under ZenithResearch. This lightweight frontend and its deployment UI
component use independent Git roots; no private historical object is imported.
No original repository is renamed, replaced, force-pushed or made public.

Included: the local operator UI, bounded controller bridge, deployment contract
tests, pinned Mac controller/profile, tokens and committed UI source snapshot.
Excluded: commercial font binaries, local environment files, credentials, installed
data, private evidence archives, review uploads and legacy placeholder test claims.
The separate UI export excludes the private gallery's investor decks and imagery.

The companion component is available at ZenithResearch/zenith-ui-deployment. Its
public commit and exact source hashes are recorded in profiles/source-provenance.json.
The frontend vendors the snapshot and requires no private/sibling dependency.

Runtime, Service Management, Frank and a synthetic roadmap now have independent
public baselines. The Mac base-installation prerelease is rebuilt from the exact
three public component commits in the release profile, with two matching wheel
builds and a disposable macOS install/doctor/start/stop acceptance. Installed pilot
data and original private histories remain unchanged. Wallet disclosure review and
Native authority are separate; this release does not enroll custody or grant roles.
Matrix intake and live-provider qualification remain unfinished.

Run npm audit against the exact lockfile and gitleaks against both the exported
source and every reachable commit before publishing. Keep required upstream MIT
notices. New project license grants are not inferred; NOTICE.md records the current
license scope. A successful source build does not establish production readiness.
