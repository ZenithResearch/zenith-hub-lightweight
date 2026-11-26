"""Run the fixed Case workflow through the installed owners' public interfaces."""
import contextlib
import hashlib
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

from process_runtime_client import LocalDevAuthority, RuntimeClient, RuntimeClientError, command_envelope

HERE = Path(__file__).resolve().parent
RECIPE = json.loads((HERE / "recipe.json").read_text())
PIN = RECIPE["pin"]
ACTOR = "hub-example-frank"


def save(path, value):
    temp = path.with_suffix(".pending")
    with temp.open("w") as stream:
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def poll(label, read, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = read()
        if result:
            return result
        time.sleep(.15)
    raise RuntimeError("Timed out waiting for " + label)


def http(port, path, body=None):
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("POST" if body is not None else "GET", path, body,
                     {"Content-Type": "application/json"} if body is not None else {})
        response = conn.getresponse()
        data = json.loads(response.read())
        if response.status != 200:
            raise RuntimeError(f"{path} HTTP {response.status}: {data.get('error', data.get('checks'))}")
        return data
    finally:
        conn.close()


@contextlib.contextmanager
def service(module, root, args):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    argv = [sys.executable, "-I", str(HERE / "service.py"), module, "--database", str(root / (module + ".sqlite")),
            "--port", str(port), "--environment", "development", "--local-dev-untrusted", *args]
    with subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL) as proc:
        def readiness():
            if proc.poll() is not None:
                raise RuntimeError(module + " exited during startup")
            try:
                return http(port, "/ready")
            except (ConnectionError, RuntimeError):
                return None
        try:
            ready = poll(module + " readiness", readiness)
            yield port, ready
        finally:
            proc.stdin.close()
            try:
                proc.wait(6)
            except subprocess.TimeoutExpired:
                proc.kill()


def query(client, op, **payload):
    return client.query({"schema": "runtime.query.v1", "operation": op, "payload": payload})["data"]


def publish(client):
    try:
        pin = query(client, "version.get", process_version=PIN["process_version"])["pin"]
    except RuntimeClientError as exc:
        if exc.code != "not_found":
            raise
        draft = RECIPE["draft"]
        provenance = {"source_id": "hub-local-example", "media_type": "application/json",
                      "content_hash": hashlib.sha256(json.dumps(draft, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                      "parser": "explicit-structured-block.v1", "uncertainties": []}
        result = client.execute(command_envelope("process.draft.put", request_id="hub-example-draft-v1",
                                expected_version=None, payload={"draft": draft, "provenance": provenance}))
        client.execute(command_envelope("process.publish", request_id="hub-example-publish-v1",
                       expected_version=result["version"], payload={"process_id": PIN["process_id"],
                       "draft_revision": result["result"]["revision"], "version_id": PIN["process_version"]}))
        pin = query(client, "version.get", process_version=PIN["process_version"])["pin"]
    if pin != PIN:
        raise RuntimeError("The retained process version conflicts with the example recipe")


def worker(root, origin, *args):
    result = subprocess.run([sys.executable, "-I", str(HERE / "worker.py"), str(root), origin, *args],
                            capture_output=True, text=True, timeout=35)
    if result.returncode:
        diagnostic = result.stderr.strip().splitlines()
        raise RuntimeError("Frank: " + (diagnostic[-1][:250] if diagnostic else "worker interrupted"))
    return json.loads(result.stdout)


def service_body(action, op, payload):
    case = op.startswith("case.")
    return {"request_id": action["id"] + "-" + op, "operation": op, "resource": {
            "kind": "Case" if case else "ServiceRequest", "id": action["caseId" if case else "requestId"]},
            "payload": payload}


def read_service(port, action, op):
    payload = {"after_revision": 0, "limit": 2} if op == "case.plan-history" else {}
    body = {"schema": "service.query.v1", **service_body(action, op, payload)}
    return http(port, "/v1/queries", json.dumps(body))["data"]


def deliver(port, action, record):
    stages = [("request.create", None, {"summary": "Uppercase a local example"}),
              ("request.qualify", 1, {"qualification": "Fixed local input"}),
              ("request.accept", 2, {"acceptance": "Accepted for the local example"}),
              ("request.convert", 3, {"case_id": action["caseId"], "obligation": "Uppercase the text"}),
              ("case.plan", 1, {"scope": "Uppercase the fixed input locally"}),
              ("case.plan.approve", 2, {"revision_id": action["revisionId"], "reason": "Run reviewed local example",
                                        "pin": PIN, "inputs": RECIPE["input"], "carry_forward": []})]
    for op, expected, payload in stages:
        if op in action["acks"]:
            continue
        body = {"schema": "service.command.v1", **service_body(action, op, payload), "expected_version": expected}
        raw = json.dumps(body, sort_keys=True, separators=(",", ":"))
        intent = action["intents"].setdefault(op, {"subject": "local-dev-untrusted", "body": raw})
        if intent != {"subject": "local-dev-untrusted", "body": raw}:
            raise RuntimeError("Retained Service intent differs from the recipe")
        record(op)
        action["acks"][op] = http(port, "/v1/commands", intent["body"])
        record(op + " acknowledged")
    def started():
        handoff = read_service(port, action, "request.execution")["handoff"]
        if handoff and handoff["state"] == "failed":
            raise RuntimeError("Service handoff failed: " + str(handoff.get("error_code")))
        return handoff if handoff and handoff["state"] == "started" else None
    record("Waiting for Service handoff")
    return poll("Service handoff acknowledgement", started)


def verify(client, port, root, action):
    import sqlite3
    run_id = action["runId"]
    run = query(client, "run.get", run_id=run_id)
    step, = run["steps"]
    ids = {"run_id": run_id, "step_id": "uppercase", "attempt_id": step["attempt_id"]}
    attempt = query(client, "attempt.get", **ids)
    output = query(client, "output.get", **ids)
    receipt = query(client, "receipt.get", receipt_id="receipt-" + ids["attempt_id"])
    expected = RECIPE["output"]
    digest = hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if (run["state"] != "succeeded" or run["pin"] != PIN or run["inputs"] != RECIPE["input"] or
        step["step_id"] != ids["step_id"] or output["outputs"] != expected or
        receipt["output_digest"] != digest or output["output_digest"] != digest or receipt["pin"] != PIN or
        any(row[k] != v for row in (attempt, output, receipt) for k, v in ids.items()) or
        any(row["actor_id"] != ACTOR or row["fence"] != step["fence"] for row in (receipt, attempt))):
        raise RuntimeError("Runtime receipt does not match the example")
    commits = [event["data"] for page in client.event_pages() for event in page["events"]
               if event["kind"] == "output.committed" and event["data"].get("run_id") == run_id]
    if len(commits) != 1 or commits[0]["attempt_id"] != ids["attempt_id"]:
        raise RuntimeError("Runtime must have exactly one committed output for the example run")
    with sqlite3.connect((root/"uppercase.sqlite").as_uri() + "?mode=ro", uri=True) as db:
        matches = [json.loads(v) for (v,) in db.execute("SELECT result FROM results")
                   if json.loads(v)["binding"]["run_id"] == run_id]
    if len(matches) != 1 or matches[0]["outputs"] != expected or matches[0]["binding"] != {**ids, "fence": step["fence"]}:
        raise RuntimeError("Frank integration evidence differs from the committed output")
    def projected():
        summary = read_service(port, action, "case.summary")
        return summary if (summary.get("derived_runtime") or {}).get("state") == "succeeded" and summary["projection"]["freshness"] == "current" else None
    summary = poll("current Service projection", projected)
    history = read_service(port, action, "case.plan-history")["revisions"]
    execution = read_service(port, action, "request.execution")
    if (len(history) != 1 or history[0]["new_pin"] != PIN or history[0]["author"] != "local-dev-untrusted" or execution["case_id"] != action["caseId"] or
        summary["handoff"] != execution["handoff"] or summary["handoff"]["run_id"] != run_id or
        summary["canonical_service"]["current_plan_revision_id"] != action["revisionId"]):
        raise RuntimeError("Service Case, handoff and process pin disagree")
    return {"output": output["outputs"], "receiptId": receipt["receipt_id"], "attemptId": ids["attempt_id"],
            "actorId": ACTOR, "effectId": matches[0]["effect_id"], "outputDigest": digest,
            "handoffId": execution["handoff"]["event_id"], "caseState": summary["canonical_service"]["state"],
            "projection": summary["projection"]["freshness"], "pin": PIN}


def main(root, mode, action_id=None):
    import uuid
    with service("process_runtime", root, []) as (runtime_port, runtime_ready):
        origin = f"http://127.0.0.1:{runtime_port}"
        client = RuntimeClient(origin, authority=LocalDevAuthority(environment="development"))
        args = ["--runtime-endpoint", origin, "--projection-database", str(root / "projection.sqlite"),
                "--poll-runtime", "--poll-interval", "0.25"]
        with service("service_management", root, args) as (port, service_ready):
            if not {"outbox_delivery", "runtime_projection"} <= service_ready["checks"].keys():
                raise RuntimeError("Service delivery and projection workers are unavailable")
            if mode == "prepare":
                publish(client)
                worker(root, origin, "register")
                return {"runtime": runtime_ready["checks"], "service": service_ready["checks"]}
            file = root / ("action-" + str(uuid.UUID(action_id)) + ".json")
            action = json.loads(file.read_text())
            def record(stage):
                action["stage"] = stage
                action["timeline"].append({"stage": stage, "at": time.time()})
                save(file, action)
            if mode == "verify":
                return verify(client, port, root, action)
            try:
                action.pop("error", None)
                if query(client, "version.get", process_version=PIN["process_version"])["pin"] != PIN:
                    raise RuntimeError("Process version no longer matches the recipe")
                handoff = deliver(port, action, record)
                action["runId"] = handoff["run_id"]
                record("Frank execution")
                if query(client, "run.get", run_id=action["runId"])["state"] != "succeeded":
                    result = worker(root, origin, "execute", action["runId"], action["id"] + "-claim")
                    if result["state"] != "committed":
                        raise RuntimeError("Frank effect requires reconciliation: " + result["state"])
                record("Verifying Runtime receipt and Service projection")
                action["result"] = verify(client, port, root, action)
                record("Completed")
                return action["result"]
            except Exception as error:
                action["error"] = str(error)[:350]
                save(file, action)
                raise


if __name__ == "__main__":
    print(json.dumps(main(Path(sys.argv[1]), *sys.argv[2:])))
