FROM node:24-bookworm-slim AS ui
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run check:source && npm run test:deployer && npm run build

FROM python:3.12.12-slim-bookworm AS application
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY --from=sources service.tar runtime.tar sources.json ./
RUN mkdir service runtime && tar -xf service.tar -C service && tar -xf runtime.tar -C runtime \
 && python -m pip install --no-cache-dir ./runtime ./service \
 && python -c 'from service_management.zenith_projection import ontology_sources; from process_runtime.ontology import ontology_sources as runtime_sources; assert ontology_sources()["closureVerified"]; assert runtime_sources()["closureVerified"]'
RUN groupadd --gid 10001 demo && useradd --uid 10001 --gid demo --create-home demo \
 && mkdir /data /opt/hub && chown demo:demo /data /opt/hub
COPY --from=ui /usr/local/bin/node /usr/local/bin/node
RUN node --version
COPY --from=ui /build/.next/standalone /opt/hub/
COPY --from=ui /build/.next/static /opt/hub/.next/static/
COPY --from=ui /build/public /opt/hub/public/
COPY profiles/process-docker/supervisor.py /opt/hub/supervisor.py
COPY --from=sources sources.json /opt/hub/sources.json
WORKDIR /opt/hub
ENV PYTHONUNBUFFERED=1 NEXT_TELEMETRY_DISABLED=1 PORT=4218 HOSTNAME=0.0.0.0 \
 ZENITH_CONTAINER_DEMO=1 ZENITH_OPERATOR_ORIGIN=http://127.0.0.1:4218
USER demo
EXPOSE 4218
STOPSIGNAL SIGTERM
CMD ["python", "-B", "/opt/hub/supervisor.py"]
