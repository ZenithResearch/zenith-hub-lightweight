"""Bounded Frank worker for the Hub development example's one adapter."""
import asyncio
import hashlib
import json
import sqlite3
import sys
from importlib.resources import files
from pathlib import Path

import httpx
from frank_executor.authority import LocalDevAuthority, LocalDevResults
from frank_executor.bootstrap import configured_registry
from frank_executor.executor import Executor
from frank_executor.journal import Journal
from frank_executor.model import Binding, Rejected, effect_key
from frank_executor.runtime import ContractValidator, GeneratedClientAdapter, RuntimeGateway
from process_runtime_client import LocalDevAuthority as SDKAuthority, RuntimeClient

ACTOR = "hub-example-frank"
OPERATION = "uppercase"
SCOPE = "example"


class Uppercase:
    contract_version = "frank.integration.v1"
    provider_idempotent = True

    def __init__(self, identifier, root):
        self.integration_id = identifier
        self.database = root / "uppercase.sqlite"

    async def connect(self):
        with sqlite3.connect(self.database) as db:
            db.execute("CREATE TABLE IF NOT EXISTS results (effect TEXT PRIMARY KEY, packet TEXT NOT NULL, result TEXT NOT NULL)")

    async def close(self):
        pass

    async def capabilities(self):
        return {"send", "receive", "health", "cancel", "reconcile"}

    async def health(self):
        return {"ready": True}

    async def send(self, work):
        if (work["actor_id"], work["operation"], work["scope"], work["inputs"]) != (
                ACTOR, OPERATION, SCOPE, {"text": "hello hub"}):
            raise Rejected("Work is outside the local example")
        result = {k: work[k] for k in ("binding", "actor_id", "integration_id", "route", "effect_id")}
        result.update(schema="frank.result.v1", event_id="upper-" + hashlib.sha256(work["effect_id"].encode()).hexdigest()[:40],
                      provider_reference=work["effect_id"], outcome="succeeded",
                      outputs={"text": work["inputs"]["text"].upper()})
        packet = json.dumps(work, sort_keys=True)
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO results VALUES (?, ?, ?) ON CONFLICT(effect) DO NOTHING",
                       (work["effect_id"], packet, json.dumps(result)))
        return await self.reconcile(work, work["effect_id"])

    async def reconcile(self, work, provider_reference):
        with sqlite3.connect(self.database) as db:
            row = db.execute("SELECT packet,result FROM results WHERE effect=?", (work["effect_id"],)).fetchone()
        if row and json.loads(row[0]) != work:
            raise Rejected("Effect refers to different work")
        return json.loads(row[1]) if row else None

    async def receive(self, cursor):
        return [], cursor

    async def cancel(self, work):
        return False


async def execute(root, endpoint, action, run_id=None, request_id=None):
    config = {"schema": "frank.integrations.v1", "integrations": [
        {"id": "uppercase-local", "plugin": "hub.uppercase.v1", "enabled": True, "config": {}}],
        "actors": [{"actor_id": ACTOR, "integration_id": "uppercase-local", "capabilities": [OPERATION],
                    "resources": [SCOPE], "route": "local"}]}
    sdk = SDKAuthority(environment="development")
    authority = LocalDevAuthority(lambda raw: sdk(json.loads(raw)), environment="development", enabled=True)
    schema = json.loads(files("process_runtime_client").joinpath("runtime-v1.schema.json").read_text())
    journal = Journal(str(root / "frank.sqlite"))
    gateway = RuntimeGateway(GeneratedClientAdapter(RuntimeClient(endpoint)), authority, journal, ContractValidator(schema))
    async with httpx.AsyncClient(trust_env=False) as http:
        registry = configured_registry(config, http_client=http, environment="development",
                                       extra_factories={"hub.uppercase.v1": lambda name, _: Uppercase(name, root)})
        executor = Executor(gateway, registry, journal, LocalDevResults(environment="development", enabled=True),
                            environment="development")
        await registry.connect()
        try:
            if action == "register":
                # Exact retry also handles a crash after the registration acknowledgement.
                return await gateway.execute("actor.register", {"actor_id": ACTOR, "capabilities": [OPERATION],
                                             "resources": [SCOPE]}, None, request_id="hub-example-register-v1")
            run = await gateway.query("run.get", {"run_id": run_id})
            step, = run["steps"]
            if step["step_id"] != OPERATION:
                raise Rejected("Unexpected step")
            if step.get("attempt_id"):
                binding = Binding(run_id, OPERATION, step["attempt_id"], step["fence"])
                key = effect_key(binding, OPERATION, SCOPE)
                attempt = await executor.recover(binding, ACTOR)
                # Missing or ambiguous delivery evidence cannot authorize a second dispatch.
                journal.get(key)
                return await executor.run(attempt, operation=OPERATION, scope=SCOPE, resume=True, wait_seconds=10)
            work = (await executor.work(ACTOR, limit=100))["work"]
            item = next((v for v in work if (v["run_id"], v["step_id"]) == (run_id, OPERATION)), None)
            if not item:
                raise Rejected("Waiting for eligible work for the example actor")
            attempt = await executor.claim(ACTOR, item, request_id=request_id)
            return await executor.run(attempt, operation=OPERATION, scope=SCOPE, wait_seconds=10)
        finally:
            await registry.close()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(execute(Path(sys.argv[1]), *sys.argv[2:]))))
