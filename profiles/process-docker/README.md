# Local Docker process demo

This is a development profile, separate from the native Mac provider launcher.
It runs the real Lightweight Hub, Service Management and Process Runtime from
reviewed source commits with verified normalized Zenith 0.1.0 imports. Source
pins and archive hashes are retained at `/opt/hub/sources.json` in the image.

```sh
python3 profiles/process-docker/prepare.py --service-source /path/to/service-management --runtime-source /path/to/process-runtime
docker compose -f profiles/process-docker/compose.yaml up --build -d
```

Open http://127.0.0.1:4218. Status is read-only in the browser; use Compose for
start/stop/logs. `docker compose -f profiles/process-docker/compose.yaml down`
preserves the named volume. Do not use `down -v` unless intentionally discarding
demo records. Component APIs stay inside the container on numeric loopback so
the public SDK endpoint policy is unchanged. No host service database, Wallet,
credential or Docker socket is mounted. Only the Hub port is published, to host
loopback. `local-dev-untrusted` is explicit; native authority, Matrix intake,
Frank actors and external effects are not qualified by this demo.

An SAI demo belongs to its own private repository/image layer. It may add the
fixed `/opt/sai-demo/server.py` entrypoint and publish its UI separately. Do not
copy private SAI assets into this public repository. The same named volume must
not be shared between separately running stacks.

A polymorphic instance query for all `zn:Artifact` subclasses is deferred. The
merged ontology supplies the inheritance closure; it does not add a record index
or a federated query endpoint.
