"""One owned loopback namespace preserves the public SDK's endpoint policy.

This profile is explicitly local-dev-untrusted. It never mounts Wallet keys,
existing databases, or the Docker socket. Compose owns lifecycle.
"""
import json, os, pathlib, signal, subprocess, sys, time, urllib.request
children = []
stopping = False
def stop(*_):
    global stopping
    stopping = True
for name in (signal.SIGTERM, signal.SIGINT): signal.signal(name, stop)
def start(args):
    child = subprocess.Popen(args)
    children.append(child)
    return child
def ready(port):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline and not stopping:
        if any(child.poll() is not None for child in children): raise RuntimeError("Component exited")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/ready", timeout=1) as response:
                if json.load(response).get("ready") is True: return
        except (OSError, ValueError): pass
        time.sleep(.25)
    raise RuntimeError("Component readiness deadline exceeded")
def main():
    os.umask(0o077)
    root = pathlib.Path("/data")
    for name in ("service", "runtime", "sai"): (root / name).mkdir(exist_ok=True)
    start([sys.executable, "-m", "process_runtime", "--database", "/data/runtime/runtime.db", "--port", "8092", "--environment", "test", "--local-dev-untrusted"])
    ready(8092)
    start([sys.executable, "-m", "service_management", "--database", "/data/service/service.db", "--port", "8091", "--environment", "test", "--local-dev-untrusted", "--runtime-endpoint", "http://127.0.0.1:8092", "--projection-database", "/data/service/projection.db", "--poll-runtime"])
    ready(8091)
    start(["node", "/opt/hub/server.js"])
    # Private demo layers may supply this fixed entrypoint; no request selects code.
    if pathlib.Path("/opt/sai-demo/server.py").is_file():
        start([sys.executable, "/opt/sai-demo/server.py"])
    print("Docker demo: local-dev-untrusted; external effects disabled", flush=True)
    while not stopping:
        if any(child.poll() is not None for child in children): return 1
        time.sleep(.25)
    return 0
if __name__ == "__main__":
    result = 1
    try: result = main()
    finally:
        for child in reversed(children):
            if child.poll() is None: child.terminate()
        deadline = time.monotonic() + 15
        for child in reversed(children):
            try: child.wait(timeout=max(.1, deadline-time.monotonic()))
            except subprocess.TimeoutExpired: child.kill(); child.wait()
    sys.exit(result)
