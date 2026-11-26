"""Exercise real process exits at the Service and Frank acknowledgement boundaries."""
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import uuid

REPO = Path(sys.argv[1])
sys.path.insert(0, str(REPO/"profiles/process-example"))
import manage
import worker
import workflow


def lose_ack(root, key):
    http = workflow.http
    def interrupted(port, path, body=None):
        result = http(port, path, body)
        if path == "/v1/commands" and json.loads(body)["operation"] == "request.convert":
            os._exit(71)
        return result
    workflow.http = interrupted
    workflow.main(root, "run", key)


def crash_worker(root, endpoint, action, run_id, request_id, fault):
    send = worker.Uppercase.send
    async def interrupted(adapter, packet):
        if fault != "unknown":
            await send(adapter, packet)
        os._exit(72)
    worker.Uppercase.send = interrupted
    if fault == "expired":
        claim = worker.Executor.claim
        async def short_lease(executor, actor, item, **kwargs):
            return await claim(executor, actor, item, **{**kwargs, "lease_ms":1000})
        worker.Executor.claim = short_lease
    asyncio.run(worker.execute(root, endpoint, action, run_id, request_id))


def crash_at_dispatch(root, key, fault):
    def stop_worker(folder, origin, *args):
        child = subprocess.run([sys.executable, "-I", __file__, str(REPO), "worker", str(folder), origin, *args, fault],
                               timeout=35)
        assert child.returncode == 72
        raise RuntimeError("test worker stopped")
    original = workflow.worker
    workflow.worker = stop_worker
    try:
        workflow.main(root, "run", key)
        raise AssertionError("Expected a worker interruption")
    except RuntimeError as error:
        assert str(error) == "test worker stopped", error
    finally:
        workflow.worker = original


def test(scratch):
    root = scratch/"recovery example"
    root.mkdir(mode=0o700)
    workflow.main(root, "prepare")
    for fault in ("committed","unknown","expired"):
        key = str(uuid.uuid4())
        manage.new_action(root, key)
        if fault == "committed":
            proc = subprocess.run([sys.executable, "-I", __file__, str(REPO), "service", str(root), key], timeout=35)
            assert proc.returncode == 71
            action = manage.read(manage.action_file(root,key))
            assert "request.convert" in action["intents"] and "request.convert" not in action["acks"]
        crash_at_dispatch(root,key,fault)
        if fault == "expired":
            time.sleep(1.5)
        if fault == "committed":
            result = workflow.main(root,"run",key)
            assert result["output"] == {"text":"HELLO HUB"}
            assert workflow.main(root,"verify",key) == result
        else:
            try:
                workflow.main(root,"run",key)
            except RuntimeError:
                pass
            else:
                raise AssertionError("Uncertain or expired effect was accepted")
        action = manage.read(manage.action_file(root,key))
        with sqlite3.connect(root/"uppercase.sqlite") as db:
            rows = [json.loads(row[0]) for row in db.execute("SELECT result FROM results")]
        assert sum(row["binding"]["run_id"] == action["runId"] for row in rows) == (0 if fault=="unknown" else 1)
        assert bool(action.get("result")) == (fault=="committed")
    print("PASS: lost Service acknowledgement, retained Frank result, ambiguous dispatch and expired fence")


if __name__ == "__main__":
    os.umask(0o077)
    if sys.argv[2] == "worker":
        crash_worker(Path(sys.argv[3]), *sys.argv[4:])
    elif sys.argv[2] == "service":
        lose_ack(Path(sys.argv[3]), sys.argv[4])
    else:
        test(Path(sys.argv[2]))
