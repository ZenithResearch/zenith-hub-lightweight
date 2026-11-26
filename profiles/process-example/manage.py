"""Review and operate the private example under this Hub's setup directory."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid
import venv

HERE = Path(__file__).resolve().parent
MAC = HERE.parent / "process-macos"
sys.path.insert(0, str(MAC))
import installer_bundle as installer

RECIPE = json.loads((HERE / "recipe.json").read_text())
DESCRIPTOR = MAC / "installer.v1.json"


def read(file):
    return json.loads(file.read_text())


def save(file, value):
    temporary = file.with_suffix(".pending")
    with temporary.open("w") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


def action_file(root, key):
    return root / ("action-" + str(uuid.UUID(key)) + ".json")


def new_action(root, key):
    file = action_file(root, key)
    if not file.exists():
        save(file, {"id": key, "requestId": "request-" + key, "caseId": "case-" + key,
                    "revisionId": "revision-" + key, "stage": "Ready", "intents": {}, "acks": {}, "timeline": []})


def status(root):
    state = read(root/"workspace.json") if (root/"workspace.json").exists() else {}
    actions = []
    for key in reversed(state.get("actions", [])):
        action = read(action_file(root, key))
        actions.append({k: action[k] for k in ("id", "caseId", "stage", "runId", "result", "error", "timeline") if k in action})
    return {"installed": bool(state), "actions": actions, "readiness": state.get("readiness")}


def review(root):
    desc = installer.descriptor(DESCRIPTOR)
    if desc["bundleSha256"] != RECIPE["bundleSha256"]:
        raise ValueError("Bundle differs from the example recipe")
    offline = os.environ.get("ZENITH_PROCESS_BUNDLE")
    return {"destination": str(root), "source": offline or desc["url"], "offline": bool(offline),
            "bytes": desc["archiveBytes"], "sha256": desc["archiveSha256"], "bundleSha256": desc["bundleSha256"],
            "components": read(MAC/"release.v1.json")["components"],
            "recipeSha256": installer.digest(HERE/"recipe.json")}


def workflow(python, root, lock, mode, *args):
    child = subprocess.run([str(python), "-I", str(HERE/"workflow.py"), str(root), mode, *args], cwd=root,
                           capture_output=True, text=True, pass_fds=(lock.fileno(),), timeout=150)
    if child.returncode:
        lines = child.stderr.strip().splitlines()
        raise ValueError(lines[-1][:400] if lines else "Local workflow interrupted")
    return json.loads(child.stdout)


def install(root, plan, lock):
    descriptor = installer.descriptor(DESCRIPTOR)
    if plan["offline"]:
        bundle = Path(plan["source"])
        installer.validate_bundle(bundle, descriptor, MAC/"process_mac.py")
    else:
        cache = root/"cache"
        cached = cache/descriptor["bundleSha256"]
        try:
            bundle = installer.ensure(DESCRIPTOR, cache)
        except ValueError:
            if cached.exists():
                cached.rename(cache/("rejected-" + uuid.uuid4().hex))
            raise
    generation = root / ("software-" + uuid.uuid4().hex)
    try:
        venv.EnvBuilder(with_pip=True, symlinks=True).create(generation)
        python = generation/"bin/python"
        requirements = generation/"wheels.txt"
        requirements.write_text("".join(
            (bundle/"wheels"/row["filename"]).resolve().as_uri() + " --hash=sha256:" + row["sha256"] + "\n"
            for row in read(MAC/"release.v1.json")["wheels"]))
        subprocess.run([str(python), "-I", "-m", "pip", "install", "--isolated", "--no-index", "--no-deps",
                        "--no-cache-dir", "--disable-pip-version-check", "--require-hashes", "-r", str(requirements)], check=True, timeout=100,
                       stdout=subprocess.DEVNULL)
        ready = workflow(python, root, lock, "prepare")
        first = str(uuid.uuid4())
        new_action(root, first)
        save(root/"workspace.json", {"generation": generation.name, "actions": [first],
                                   "reviewId": plan["id"], "readiness": ready})
    except Exception:
        if generation.exists():
            shutil.rmtree(generation)
        raise


def manage(root, operation, key=None):
    if operation == "status":
        return status(root)
    installer.private_directory(root)
    with (root/"operation.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("An example operation is running. Refresh to see its progress.") from None
        state = read(root/"workspace.json") if (root/"workspace.json").exists() else None
        if operation == "review":
            plan = {**review(root), "id": str(uuid.uuid4()), "expires": time.time() + 300}
            save(root/"review.json", plan)
            return plan
        if operation == "apply":
            if state and key == state["reviewId"]:
                return status(root)
            plan = read(root/"review.json")
            if state or plan["id"] != key or plan["expires"] < time.time() or any(plan[k] != v for k,v in review(root).items()):
                raise ValueError("Review the current example installation before applying")
            install(root, plan, lock)
        elif operation in {"new", "run", "verify"}:
            if not state or key not in state["actions"]:
                raise ValueError("Unknown example action")
            action = read(action_file(root, key))
            if operation == "new":
                if not action.get("result"):
                    raise ValueError("Complete or reconcile the current example first")
                if key == state["actions"][-1]:
                    next_id = str(uuid.uuid5(uuid.UUID(key), "next local example"))
                    new_action(root, next_id)
                    state["actions"].append(next_id)
                    save(root/"workspace.json", state)
                key = state["actions"][state["actions"].index(key) + 1]
                action = read(action_file(root, key))
            python = root / state["generation"] / "bin/python"
            if operation == "verify":
                if not action.get("result"):
                    raise ValueError("This example has no committed output to verify")
                observed = workflow(python, root, lock, "verify", key)
                if any(observed[k] != value for k,value in action["result"].items() if k != "projection"):
                    raise ValueError("Owner evidence differs from the retained action receipt")
                return observed
            if not action.get("result"):
                workflow(python, root, lock, "run", key)
        else:
            raise ValueError("Unsupported example action")
        return status(root)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        print(json.dumps(manage(Path(sys.argv[1]), *sys.argv[2:])))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
