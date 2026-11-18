FROM python:3.12.12-slim-bookworm
WORKDIR /build
COPY --from=devgraph_sources devgraph.tar sources.json ./
RUN mkdir source && tar -xf devgraph.tar -C source && python -m pip install --no-cache-dir ./source \
 && devgraph ontology --format sources-v1 > /build/ontology-sources.json
RUN groupadd --gid 10001 demo && useradd --uid 10001 --gid demo --create-home demo \
 && mkdir -p /state /reader /db-auth /opt/devgraph && chown demo:demo /state /reader
COPY profiles/devgraph-docker/bootstrap.py profiles/devgraph-docker/smoke.py profiles/devgraph-docker/devgraph_connection.py /opt/devgraph/
COPY --from=devgraph_sources sources.json /opt/devgraph/sources.json
ENV DEVGRAPH_ENVIRONMENT=production DEVGRAPH_AUTH_MODE=local-read DEVGRAPH_AUDIENCE=devgraph \
 DEVGRAPH_DATA_ROOT=/state NEO4J_URI=bolt://neo4j:7687 NEO4J_USER=neo4j NEO4J_DATABASE=neo4j NEO4J_PASSWORD_FILE=/state/secrets/neo4j_password
USER demo
CMD ["python", "-B", "/opt/devgraph/bootstrap.py", "serve"]
