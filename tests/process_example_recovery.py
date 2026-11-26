"""Exercise real process exits at the Service and Frank acknowledgement boundaries."""
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import shutil
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
    if fault == "completion":
        worker.Journal.committed = lambda *_: os._exit(72)
    else:
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


def test_offline(scratch, source):
    local = scratch/"offline bundle"
    shutil.copytree(source,local)
    root = scratch/"offline workspace"
    os.environ["ZENITH_PROCESS_BUNDLE"] = str(local)
    plan = manage.manage(root,"review")
    assert plan["offline"]
    wheel = next((local/"wheels").glob("frank_executor-*.whl"))
    wheel.write_bytes(b"broken")
    try:
        manage.manage(root,"apply",plan["id"])
        raise AssertionError("Corrupt offline wheel accepted")
    except ValueError as error:
        assert wheel.name in str(error), error
    assert not manage.manage(root,"status")["installed"]
    shutil.copyfile(source/"wheels"/wheel.name,wheel)
    manage.manage(root,"apply",plan["id"])
    assert manage.manage(root,"apply",plan["id"])["installed"]
    del os.environ["ZENITH_PROCESS_BUNDLE"]
    print("PASS: named corrupt offline wheel, repaired bundle and idempotent apply")


def test_admission(root):
    key = str(uuid.uuid4())
    manage.new_action(root,key)
    original = workflow.service
    def closed(module,folder,args):
        if module == "process_runtime":
            args = [*args,"--admission-policy",str(folder/"missing-test-policy.json")]
        return original(module,folder,args)
    workflow.service = closed
    try:
        workflow.main(root,"run",key)
        raise AssertionError("Closed admission accepted work")
    except RuntimeError as error:
        assert "admission closed" in str(error), error
    finally:
        workflow.service = original
    retained = manage.read(manage.action_file(root,key))
    event = retained["acks"]["case.plan.approve"]["handoff"]["event_id"]
    assert workflow.main(root,"run",key)["handoffId"] == event


def test(scratch):
    root = scratch/"recovery example"
    root.mkdir(mode=0o700)
    workflow.main(root, "prepare")
    test_admission(root)
    for fault in ("committed","completion","unknown","expired"):
        key = str(uuid.uuid4())
        manage.new_action(root, key)
        if fault == "committed":
            proc = subprocess.run([sys.executable, "-I", __file__, str(REPO), "service", str(root), key], timeout=150)
            assert proc.returncode == 71
            action = manage.read(manage.action_file(root,key))
            assert "request.convert" in action["intents"] and "request.convert" not in action["acks"]
        crash_at_dispatch(root,key,fault)
        if fault == "expired":
            time.sleep(1.5)
        if fault in {"committed","completion"}:
            result = workflow.main(root,"run",key)
            assert result["output"] == {"text":"HELLO HUB"}
            verified = workflow.main(root,"verify",key)
            assert result["projection"] == "current"
            assert {k:v for k,v in verified.items() if k!="projection"} == {k:v for k,v in result.items() if k!="projection"}
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
        assert bool(action.get("result")) == (fault in {"committed","completion"})
    print("PASS: lost Service acknowledgement, retained Frank result, lost completion acknowledgement, ambiguous dispatch and expired fence")


if __name__ == "__main__":
    os.umask(0o077)
    if sys.argv[2] == "worker":
        crash_worker(Path(sys.argv[3]), *sys.argv[4:])
    elif sys.argv[2] == "service":
        lose_ack(Path(sys.argv[3]), sys.argv[4])
    else:
        test(Path(sys.argv[2]))
        if len(sys.argv) == 4:
            test_offline(Path(sys.argv[2]),Path(sys.argv[3]))
