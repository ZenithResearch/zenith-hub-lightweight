# Isolated Docker Devgraph

A Hub-owned Docker composition for a separate persistent Devgraph. It uses
canonical `ZenithResearch/devgraph` main `51fb962f8d3c08904b32e8d04235315edf4d9797`
and its normalized Zenith 0.1.0 import closure. It does not change Devgraph’s
single-instance Mac launcher, the personal host on port 8080, or any host grants.

```sh
python3 profiles/devgraph-docker/prepare.py --source /path/to/devgraph
docker compose -f profiles/devgraph-docker/compose.yaml up --build --wait --wait-timeout 240
docker compose -f profiles/devgraph-docker/compose.yaml exec devgraph python /opt/devgraph/smoke.py
```

API: http://127.0.0.1:4220. Neo4j Bolt and its browser port are not published.
Five independent named volumes retain database/logs, API state, database auth,
and a minimal read credential for a trusted Hub backend. Application containers
receive only the reader volume read-only; they never receive database credentials.
The one-shot initializer creates owner-private credentials once and refuses
changed/unsafe existing values. It provisions the canonical 30-day devgraph.read
capability; it does not create a signing identity or write grant. Expiry requires
explicit operator renewal; restarts never rotate it. New database migrations run
through Devgraph’s packaged migration runner before the production API starts.

Named Work mutations remain closed until this separate instance has explicitly
qualified native Wallet/secS issuer trust and exact grants. Do not mount a host
Wallet key, copy the personal host's receiver state, use a development verifier,
or substitute a writable bearer. An empty work list is legitimate only after an
authenticated successful read. `down` preserves volumes; never use `down -v`
unless intentionally discarding this isolated instance.

The official Neo4j image uses a file for its initial database credential:
https://neo4j.com/docs/operations-manual/current/docker/docker-compose-standalone/
