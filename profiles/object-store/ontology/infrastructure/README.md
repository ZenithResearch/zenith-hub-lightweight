# Hub Infrastructure 0.1.0 — proposed, unpublished

Owner: `ZenithResearch/zenith-hub-lightweight`.

- Ontology identity: `https://zenith-research.ca/ontology/hub/infrastructure`
- Namespace / working prefix: `infra:` = `https://zenith-research.ca/ontology/hub/infrastructure/terms/`
- Versioned module: `https://zenith-research.ca/ontology/hub/infrastructure/v0.1.0/ontology.jsonld`
- Domain: `urn:zenith:hub:domain:infrastructure`, an instance of existing `zn:Domain`.

These IRIs follow Zenith's ontology URL convention while keeping Hub ownership
explicit. They identify this proposal; they do not assert that a website publishes
or resolves it. No upstream release or website is changed.

The seven classes describe compute hosts, operational software services,
placements, connectivity domains, attachments, volumes and DNS authority
boundaries. They are distinct from configuration/manifests (`zn:Artifact`) and
maintained logical collections (`zn:Collection`). No Resource superclass is added.

Machine subclasses existing Entity; ServiceInstance subclasses existing Agent.
Their mandatory Entity conformance is inherited. Infrastructure schema admission
requires a separate, exact Core EntityProjection. Endpoints, ports, paths,
Tailscale and receiver-local secS mappings belong to ImplementationBinding values,
not to Core's closed projection or to additional participant classes. Discovery,
schema admission, contract-content verification, health, reachability and
authorization are separately reported; none automatically proves another.

The module imports exact normalized Core 0.1.0, with a dependency declaration
pinning its module hash and package manifest hash. All upstream files remain
byte-for-byte unchanged in the adjacent `zenith-0.1.0` directory. This module's
manifest pins every local schema, example and resource.

The examples are synthetic and do not provision services, issue credentials,
configure DNS/Tailscale or address a real SAI environment. One external contract
reference is intentionally unresolved. Other examples use the explicitly pinned
sample contract, with declared query input/output/error schemas and the unchanged
Core Message/Reply/retry contract. A management Agent can route messages for the
Machine; their logical identities remain distinct.

From the Hub repository, run:

```sh
node scripts/verify-infrastructure.mjs
node scripts/infrastructure-diagrams.mjs
npm run test:objects
```

The verifier uses disposable SQLite stores, checks the complete local module and
schema closure, validates the Domain and examples, closes/reopens the database,
exports a portable bundle, imports it into a fresh store, and compares RDF meaning
using RDFC-1.0 plus separate binding equality. It never opens provider databases.

Full review, relationships, profiles, interfaces, limits and diagrams:
[Infrastructure review](../../../../docs/infrastructure/README.md).
