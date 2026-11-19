# Existing Devgraph resources

The Hub can register and observe an already-running Devgraph API. A resource
binding is application configuration; it introduces no ontology class and does
not imply that Hub installed, owns or can stop the provider.

Register with the owner-side CLI:

~~~sh
node scripts/resources.mjs register \
  --config /owner-private/hub-resources.json \
  --id company-devgraph --label "Company Devgraph" \
  --endpoint http://127.0.0.1:4220 \
  --credential-file /owner-private/devgraph.read
~~~

Use an existing owner-private directory (0700). The registry and referenced read
credential must be owner-owned regular files with mode 0600, no symlink and one
hard link. The credential is issued by Devgraph; this command does not create,
rotate or grant one. Eight explicitly selected loopback resources are supported.
An already-installed local host on port 8080 can be registered in exactly the
same way with its own existing read credential. Separate instances remain
separate bindings; no data or credential is copied between them.

Launch the local Hub with ZENITH_HUB_RESOURCES_FILE pointing at that registry.
Native demo or explicit local operator mode must also be selected. The browser
shows each registered resource and offers refresh, connect and disconnect.

Owner-side commands also include list, connect, disconnect and forget, each
using --config and, where appropriate, --id. Forget removes the binding only.
The registry records external lifecycle ownership. Neither the CLI nor the
resource API starts, stops or deletes Devgraph.

The GET /api/resources snapshot projects connection metadata and bounded health
observations, with an observation timestamp. Credential values and file paths
are never projected. Readiness requires both ready admission and a successful
authenticated bounded Work read. Denial, unavailable storage, incompatible API,
missing credentials and a deliberate disconnect remain distinct states.

POST /api/resources accepts same-origin CSRF-protected refresh or set-enabled
actions only. Configuration writes use a revision check and an exclusive
writer lock. Browser requests cannot choose endpoints, credential files or
process commands. Registry registration is an owner-side configuration step.

Disabling a binding stops future polls; an already-started read may finish and
is discarded if its registry revision is stale. A disconnected binding does
not mean the Devgraph service stopped. Reconnecting checks the same existing API.

Organization backends use the RegisteredConnection reader from
profiles/devgraph-docker/devgraph_connection.py with the registry path and
resource ID. Each poll reloads the binding, so Hub connection controls and the
application connection share the same configuration. This remains a read-only
capability. Signed Work mutation authority is separately owned by Wallet/secS.

The closed configuration schema is profiles/resources.schema.json.
