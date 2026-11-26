"""Run one installed service CLI while its owning Hub workflow holds stdin open."""
import os
import runpy
import signal
import sys
import threading


def owner_closed():
    os.read(0, 1)
    os.kill(os.getpid(), signal.SIGTERM)


module = sys.argv.pop(1)
if module not in {"process_runtime", "service_management"}:
    raise ValueError("Unsupported example service")
threading.Thread(target=owner_closed, daemon=True).start()
runpy.run_module(module, run_name="__main__")
