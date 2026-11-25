# Generic Matrix setup

## Implementation order

1. Correct endpoint normalization, bounded catalog discovery and authentication status. Recover owned Synapse configuration without regenerating identity.
2. Add a narrow Matrix adapter and reviewed account/session/room actions. Retain reviews and uncertain outcomes in the application repository; accept secrets only at apply time.
3. Add the canonical on-page Matrix setup component and integrate it into Apps & services.
4. Qualify using isolated protocol fixtures and disposable storage, then compare the untouched live Hub with its baseline.

## Records and authority

| Meaning | Record / owner |
| --- | --- |
| Software offering | Existing SoftwareDescriptor and catalog entry |
| Installed wheel closure | SoftwareInstallationRecord to exact SoftwareBuild revision; retained archive URL/hash stays in the native receipt. No invented Git snapshot. |
| Running homeserver | Existing ServiceInstance; endpoint and local management bindings remain separate |
| Local configuration | Existing ConfigurationProfile plus native configuration/receipt, retaining server identity and signing keys |
| Saved external endpoint | Existing Connection; grants no installation or process authority |
| Account/session | Private versioned setup binding instance.matrix.account; opaque token reference to a private credential file |
| Joined/invited rooms, permissions | Bounded, timestamped projections in instance.matrix; Synapse remains authoritative |
| Review/result | Existing retained review Artifact and private operation journal; passwords/tokens never enter these documents |
| Host/storage | Existing Host and installation bindings |

All existing ontology-backed projections retain their exact JSON-LD version binding. New Matrix binding fields are additive operational data, read absent-as-unconfigured; SQLite remains v5 and no definition pins change. Existing roots are neither migrated nor reconfigured by this feature. Installation mapping is explicit on an inspected receipt, never a reachable endpoint.

## States

API available is not authentication. An authenticated account requires /account/whoami; cached proof expires and is bound to endpoint, account and credential generation. Disabled Hub connections retain sessions without revoking them. Logout explicitly revokes only the selected session, with an extra acknowledgement for externally supplied sessions. Room membership, permissions and optional send/read evidence are separate. The administrative setup probe does not implement E2EE or establish encrypted-message readiness. The separately authorized [floating conversation client](matrix-conversations.md) owns its persistent Hub-device keys and checks chat readiness independently. The retained legacy setup probe flag is not the conversation client capability.

Non-idempotent actions are journaled before remote submission. Interrupted/ambiguous operations are never automatically replayed. Refresh reconciles current rooms and account; a human resolves remaining ambiguity before a fresh reviewed action.

## Protocol sources

- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/) (login, whoami, room state, membership, power levels, spaces and logout).
- [Synapse shared-secret registration](https://element-hq.github.io/synapse/latest/admin_api/register_api.html).
- [Synapse configuration](https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html).

The existing redirect-free, DNS-pinned HTTP adapter is reused. No custom encryption protocol is introduced. Modern delegated OAuth or unsupported interactive registration is reported as an external-client handoff rather than impersonated as password login.

## User journey

Open Matrix from **Apps & services**. Choose **Connect existing** to save a normalized server root, or **Set up on this Mac** to review the permanent server name, pinned Synapse software, downloads, storage and disk prerequisites. Saving an address grants no process authority and does not sign in.

Local preparation, installation, configuration and startup are separate reviews. After installation, review configuration; after configuration, review startup. Once the API is available, choose an advertised password/one-use-token login or explicitly supply an existing access token. A managed local server also offers account bootstrap with an explicit ordinary/admin choice. Bootstrap verifies the owned wrapper's process stamp, the Synapse child command/configuration and that exact child's listening port before using its administrative secret; a responding foreign endpoint grants no authority. Passwords and tokens are entered only at Apply; they never enter retained reviews, application documents or browser storage.

The Matrix panel refreshes known server/account evidence when opened. Its cached room forms remain usable while evidence ages; every remote mutation authenticates again. Choose a space and room independently, create or join rooms, and review changes to names, descriptions, directory visibility, join rules, membership and numeric roles. Space organization writes/removes the actual child/parent state relationships, without deleting rooms. Room-v12 creators have a distinct permission role; they are not rewritten into numeric user entries.

Optional message verification is a reviewed action against the explicitly selected unencrypted room. Sending and fetching the exact returned event are separate results. Encryption changes require explicit acknowledgement. The Hub never disables encryption or sends plaintext tests into encrypted rooms. Use the floating conversation client for encrypted messaging with its own saved Hub device; other clients may still be needed for device verification or access to older room keys.

Disable a Hub connection to suspend Hub use while preserving its session. Logout separately revokes only the chosen session; supplied sessions require acknowledgement because another client may share that token. OAuth-managed sessions may require their originating client's revocation flow if the legacy logout endpoint is unsupported.

## Application fields and resume behavior

The private setup document's instance.matrix binding is validated by profiles/setup/matrix.schema.json. It contains:

- schema/version: additive binding format and Matrix-specific change counter.
- account: endpoint, Matrix user ID, device ID, opaque credential reference, credential-content digest, generation and whether the session was supplied by the user. The private credential file holds the token; its digest prevents a changed file from silently reusing prior verification.
- view: bounded server/authentication capabilities, joined spaces/rooms, invitations, membership and power-level observations, errors, completeness and observation time. This is a cache, not Synapse's database.
- selected: independently chosen space/room, account/session/endpoint binding and the time membership was checked.
- reviewId: the retained review to reopen after reload. The review Artifact and private payload use the repository's existing exact revision/digest contract.
- operations: retained action parameters, scope digest, completed steps, sanitized errors and result. Applying operations found after a restart are shown as unknown. Unknown/partial actions block new remote mutations until explicitly acknowledged after inspection.
- messageVerification: separate send/read evidence scoped to server, account, session, room and event.

Read reviews through POST /api/matrix operation=read-review. Reviews expire after two minutes and bind exact implementation/schema bytes as well as endpoint/account state. Restart alone does not discard them. Changed code, credentials or relevant configuration requires a new review. UI cancellation retires a review without contacting the homeserver.

## Recovery and installation provenance

A new local configuration first takes an exclusive process-stamped configuration lock and commits an instance-specific identity intent, then generates Synapse configuration once. Retries validate that intent, retain signing material, and atomically finish YAML and receipt publication. Configuration proofs bind the signing-key and YAML hashes. After interruption, the Hub's Reconcile retained setup action checks that the old writer has stopped and that receipt/intent identity still matches. It marks the configuration retryable; the next explicit Configure review resumes it. A completed retry records which operation fulfilled the earlier retained intent. A live/unknown writer blocks reconciliation, and a stale process lock is removed only when its process identity no longer matches. A different identity, changed key/configuration, foreign path, retained key without YAML, or an existing database/media at a different path blocks recovery instead of replacing or redirecting it.

For an older interrupted configuration without a matching identity intent, first stop native writers and retain a backup of the private instance directory (YAML, signing keys, database, media and receipts) and original reviewed installation plan. The explicit reconciliation command requires that original plan, a matching installed receipt/controller/wheel closure, the same server identity, private signing material and qualified storage paths:

~~~sh
node scripts/setup/matrix-reconcile.mjs \
  --plan /absolute/setup/plans/retained-instance-plan.json \
  --installation-plan /absolute/setup/plans/original-installation-plan.json \
  --review /absolute/private/matrix-recovery-review.json
# Inspect the displayed effects and private review before applying:
node scripts/setup/matrix-reconcile.mjs \
  --apply /absolute/private/matrix-recovery-review.json
~~~

The optional installation-plan argument can be omitted when the matching plan is in the setup root's plans directory. Apply rechecks all retained hashes under the native configuration lock, then writes only config/matrix-identity.json. It does not modify YAML, keys, database or media, start a server, adopt a listening endpoint or invent missing ownership/provenance. Return to the Hub, use Reconcile retained setup, and explicitly review Configure again. Unknown ownership, changed files or non-default retained storage requiring migration block this action.

The Synapse receipt mapper verifies retained wheel hashes, controller identity and installed entrypoint. It creates an existing SoftwareBuild profile over the wheel artifact and pins the installation to that exact build object version. One receipt copy ID identifies the installed copy; an upgrade gets a new installation description. A moved copy keeps its original build pin after descriptive build revisions. Source-archive URL/hash facts remain in the retained native receipt: the commit-only SoftwareSourceSnapshot profile stays absent when no Git commit is known. Full environment-wide presence inspection remains unknown, separate from receipt, API and account evidence.

## Compatibility and deployment boundary

No ontology definitions, pinned application-definition set, SQL schema version or existing storage owners change. Absent Matrix bindings mean setup has not been completed. The old endpoint/secret-reference readers remain usable. Old unqualified Matrix credential bindings without a content digest require fresh sign-in; they are not silently requalified. Historical integration/publication input ledgers are retained; matrix-inputs.json records exact authorized follow-up hashes.

This work is on isolated codex/matrix-setup branches. The live Hub checkout, setup root, existing connections, Hermes process and unregistered server on port 8008 are not adopted or redeployed.

## Qualification

See matrix-validation.json for commands, results and preservation evidence. Routine tests use an in-process disposable protocol fixture and private temporary repositories. Native tests use disposable YAML/key/database/media files and never start the existing Synapse process.

Actually qualified: protocol fixture password and token authentication, bootstrap HMAC and explicit privilege choice, expired/revoked and replaced credentials, account/room state, space creation/link/unlink, room creation/join/invitations, metadata, permissions, partial and ambiguous outcomes, clear encryption limits, exact send/read verification, persistent reviews/selections across Hub restart, and production/standalone/development API packaging.

Not qualified against a newly installed real Synapse or remote HTTPS provider in this change: source build/runtime startup, real first-account provisioning, federated room behavior, delegated OAuth/SSO browser login or token refresh, and federated E2EE behavior. Persistent native E2EE and HTTP conversation packaging are qualified separately in [Matrix conversations](matrix-conversations.md). Existing pinned local build/install mechanisms remain; a real native walkthrough needs a separate disposable instance and resource preflight. No model, bot, intake workflow, SAI template, Devgraph connection, VPS, DNS or public TLS automation is added.
