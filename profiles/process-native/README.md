# Native demo source profile

This release-owned manifest identifies the exact public Service and Runtime
sources for isolated native demonstrations. Organization demos clone a published
Hub tag, verify its commit, read this profile, and install its component commits
in their own Python 3.12 environment. The Hub frontend is built from that same
clean release checkout using Node 24 and npm ci.

Organization application code, ontology extensions, instance data and connection
settings belong to their own repositories and directories. No existing Mac
installation, Wallet identity, Matrix connection or Work authority is adopted
by selecting this synthetic local-dev-untrusted profile.

The component pins must match the Docker demo profile; CI verifies that contract.
