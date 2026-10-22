# Anima MVP provider delivery runbook

Prepared: 2026-10-22  
Parent plan: [Zenith Application Substrate v1 delivery plan](2026-10-21-zenith-application-substrate-v1.md)

## Objective

Make the Anima client complete one real, repeatable service-delivery loop using
released Zenith provider components. Then add the two additional transfer paths
Anima needs most: Matrix and a local-folder mailbox. General peer synchronization
and the remaining connector catalog continue after the MVP review.

Anima calls Service Management's configured provider intake directly. It does not
connect to, host or synchronize with a local substrate service. Queue and Matrix
are optional reachable mailboxes in front of the same admission boundary. A local
folder is a provider/operator mailbox. On full local installations, Zenith
Transfer composes Castalia Wallet custody and may manage the optional sync/mailbox
sidecar plus its current/behind/unavailable/conflict state.

The execution order is fixed until new evidence invalidates a dependency:

1. finish the Vercel Queue request/reference and read-only response path;
2. prove Anima through substantive returned deliverables;
3. extract the proven Queue behavior behind transport-neutral ports;
4. qualify Matrix;
5. qualify a local-folder mailbox;
6. pause for the Anima MVP review;
7. continue with the prioritized follow-on work.

Direct Tailscale synchronization is follow-on work. It is neither an Anima MVP
gate nor precommitted to a two-stack, one-record-family qualification.

## Slice 1 — Finish the Vercel Queue path

**Owner:** provider gateway and Service Management.  
**Depends on:** released/pinned Service client, secS producer and opener, selected
Vercel project and region, bounded Queue resources, exact Anima origin, provider
recipient key, membership verifier and finite Service authority.

Prepared source already exists for the bounded request and reference gateways,
official byte-topic publisher and poll consumer, local durable inbox, stable
idempotency, acknowledgement-after-commit, authorized projection and exact route
mapping. The remaining work is release composition and real configuration.

Exit criteria:

- Anima stores exact prepared request and reference ciphertext before first send.
- The gateway returns only a transport result and never claims Service admission.
- The provider poller durably commits before Queue acknowledgement.
- Duplicate delivery, lost acknowledgement, restart and unknown publish outcome
  preserve one logical request and one reference object.
- Authorized status, artifact and receipt reads work through the configured
  projection; another member and expired authority are denied.
- Queue payloads and logs contain no browser private key, provider credential,
  local path or plaintext reviewed brief/reference bytes.

Required evidence:

- released component versions and provider-bundle manifest hash;
- redacted Vercel project/region/topic/consumer-group/retention configuration;
- exact-origin/CORS and recipient-key fingerprints;
- request/reference Queue receipts plus local durable-commit receipts;
- negative-path, restart and deduplication test results.

## Slice 2 — Prove Anima end to end

**Owner:** Anima consumer reviewer, Service Management, Runtime, Frank and the
human service reviewer.  
**Depends on:** Slice 1 and the immutable `zenith.anima.brand-package` release.

Exit criteria:

- Anima reuses its reviewed brief and selected-reference manifest without asking
  for the same intake again.
- One authorized submission becomes exactly one ServiceRequest and one Case pinned
  to the reviewed workflow version.
- Runtime and Frank consume the exact immutable brief/reference artifacts.
- The required human-review step is completed explicitly.
- The provider returns the three substantive deliverables, canonical status and
  receipt references; Anima verifies descriptor length/digest before display or
  library import.
- Retry and browser restart resume the same request; no fixture or placeholder is
  presented as live work.

Required evidence:

- request, Case, process-version, Run and artifact identifiers;
- workflow and input/output digests;
- human-review receipt and substantive deliverable review;
- Anima screenshots or captured browser states for accepted, running,
  review-needed and delivered conditions;
- authorized retrieval, cross-member denial and unknown-outcome reconciliation.

## Slice 3 — Extract the proven Queue behavior

**Owner:** Service Management with adapter-contract review.  
**Depends on:** Slice 2. Generalization before the live proof is avoided.

Extract only the behavior proven by the Queue path: exact logical identity,
immutable payload descriptors, durable commit, acknowledgement, retry, expiry and
unknown-outcome reconciliation. Keep Queue SDK types and credentials inside the
Queue adapter. Do not route direct provider intake or secS Magik RPC through this
boundary.

The extracted boundary is an adapter contract, not a mandatory sync service.
Direct Anima intake continues to call Service Management without this hop.

Exit criteria:

- the Queue implementation passes unchanged wire-contract acceptance tests;
- an adapter conformance fixture can drive deposit/list-or-receive/fetch/commit/
  acknowledge/reconcile without importing Vercel SDK types;
- replaying the same identity and digest is idempotent and changed bytes under the
  same identity enter quarantine;
- transport receipts remain distinct from Service and Runtime receipts.

## Slice 4 — Qualify Matrix

**Owner:** Matrix adapter and local provider intake.  
**Depends on:** Slice 3 and one explicitly configured Matrix account/room policy.

Matrix may carry a bounded encrypted package or an opaque locator for a larger
object. Its access token supplies transport access only. It grants no membership,
organization authority, Service admission or runtime execution.

The provider-side Matrix adapter invokes the same Service Management admission
port after durable commit. Anima does not become a substrate peer.

Exit criteria:

- exact sender/room/event provenance is retained without treating it as requester
  authority;
- duplicate events and sync restarts produce one durable local package;
- the sync cursor advances only after all selected events durably commit;
- encrypted payload and locator modes both enforce size, origin, digest, expiry
  and recipient policy;
- a Matrix delivery failure cannot corrupt or advance canonical Service state;
- sensitive tokens and event bodies are redacted from operational logs.

## Slice 5 — Qualify a local-folder mailbox

**Owner:** file-mailbox adapter and local provider intake.  
**Depends on:** Slice 3. It may proceed in parallel with Slice 4 after the adapter
contract freezes.

The folder contains immutable manifests and content-addressed payloads. It does
not mirror arbitrary directories and never relies on matching absolute paths.

Exit criteria:

- producers publish through a temporary file followed by an atomic rename;
- consumers reject symlinks, traversal, oversize files, changed bytes, malformed
  manifests and identity/digest conflicts;
- payloads commit locally before the manifest is acknowledged or moved;
- restart and duplicate scans are idempotent;
- quarantine is inspectable and preserves the original evidence.

## Slice 6 — Anima MVP review

The review passes when one released Anima service works through Vercel Queue,
authoritative projection, Matrix and local-folder profiles with the evidence
above. It records operational instructions, supported limitations and the exact
remaining blocker list.

The review then ranks, rather than automatically starts, the follow-on sequence:

1. direct Tailscale synchronization scoped by a concrete application need;
2. Zenith Transfer installation and configuration;
3. Daycall conformance;
4. Dropbox, WebDAV, Nostr or hosted-mailbox adapters;
5. broader records, reseeding, multi-peer operation and conflict handling.

## Work-state rule

Planning, source completion, deployment, activation and production qualification
remain separate states. A Queue receipt, Matrix event, file appearance, HTTP
liveness check or green source test cannot advance an Anima delivery gate without
the corresponding durable domain evidence.
