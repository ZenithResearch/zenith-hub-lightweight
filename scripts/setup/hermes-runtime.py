"""Instance-owned engine policy for Inkling; no downloads or config writes on import.

Uses Hermes's PM Store, native resumable transfers, local server supervisor and
job lifecycle. The Unsloth root layout must never reach Hermes's older engine.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
from contextvars import ContextVar
from contextlib import contextmanager

GIB = 1024**3
MIN_CONTEXT = 64000
MODEL_ID = "inkling-2-mini"
_ENGINE_CHOICE = ContextVar("hub_local_model_engine_choice", default=None)


@contextmanager
def engine_choice(model_id):
    token = _ENGINE_CHOICE.set(model_id)
    try:
        yield
    finally:
        _ENGINE_CHOICE.reset(token)


def atomic_json(file, value):
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = file.with_suffix(".next")
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, file)
    finally:
        tmp.unlink(missing_ok=True)


def model(manifest):
    return next(m for m in manifest["models"] if m["id"] == MODEL_ID)


def compatible(m):
    policy = m["managed"]
    files = m["catalog"]["variants"][0]["files"]
    engine = policy["engine"]
    return (policy["layout"] == "unsloth-looped-root"
            and m["catalog"]["architecture"] == "inkling2"
            and engine["repository"] == "unslothai/llama.cpp"
            and engine["commit"] == "e854428673114be17c32272440a43f4b4ebd20b8"
            and engine["sha256"] == "229def18e27ed740ec4f3a6508f084b25630e08d8a87ada40b00622fc496ceb8"
            and len(files) == 1 and files[0]["path"] == "Inkling-2-Mini-UD-Q4_K_XL.gguf"
            and files[0]["sha256"] == "e62d463c135ffe283df8d94b279a96ca145ac128b52ce854478613045bf4de15"
            and m["catalog"].get("mmproj") is None
            and policy["contextTokens"] >= MIN_CONTEXT)


def preflight(m, hw, *, free, missing_weights, missing_engine=True, target=None):
    """All terms are bytes; this is an estimate, never a measured qualification."""
    p = m["managed"]
    spec = p["memory"]
    ctx = p["contextTokens"]
    weights = sum(f["size_bytes"] for f in m["catalog"]["variants"][0]["files"])
    kv = (spec["fullAttentionApplications"] * ctx
          + spec["localAttentionApplications"] * min(ctx, spec["localWindowTokens"])) * spec["kvBytesPerTokenPerApplication"]
    running = max(0, int(hw.get("ram_total_bytes", 0)) - int(hw.get("ram_available_bytes", 0)))
    runtime_need = weights + kv + spec["runtimeOverheadBytes"]
    total_need = max(spec["minimumPhysicalBytes"], runtime_need + max(spec["systemReserveBytes"], running))
    engine = p["engine"]
    download = missing_weights + (engine["size_bytes"] if missing_engine else 0)
    required = download + (engine["expandedBytes"] if missing_engine else 0) + 2 * GIB
    problems = []
    target = target or ("darwin-arm64" if platform.system() == "Darwin" and platform.machine() == "arm64" else platform.system().lower() + "-" + platform.machine())
    if target != p["platform"]:
        problems.append("Managed Inkling is pinned only for Apple silicon. Use a compatible existing server on this platform.")
    if not compatible(m):
        problems.append("The GGUF layout and serving engine do not match the reviewed Inkling pair.")
    if ctx < MIN_CONTEXT:
        problems.append("Hermes requires at least 64,000 tokens actually served.")
    if hw.get("ram_total_bytes", 0) < total_need or hw.get("ram_available_bytes", 0) < runtime_need:
        problems.append("Inkling needs at least 32 GiB physical RAM and enough currently available memory for all weights, a 65,536-token cache and runtime overhead. Close other services or use another server.")
    if free < required:
        problems.append(f"Need {required / GIB:.1f} GiB free on the instance volume; {free / GIB:.1f} GiB is available.")
    return {"prerequisites": problems, "downloadBytes": download, "requiredBytes": required, "availableBytes": free,
            "memory": {"weightsBytes": weights, "contextCacheBytes": kv, "runtimeOverheadBytes": spec["runtimeOverheadBytes"],
                       "otherServicesBytes": running, "estimatedWorkingSetBytes": runtime_need, "estimatedTotalBytes": total_need,
                       "availableBytes": hw.get("ram_available_bytes", 0), "basis": spec["basis"], "measured": False},
            "engine": engine, "contextLength": ctx, "qualification": m["qualification"]}


def engine_directory(root, m):
    if not root.is_absolute() or root.is_symlink() or not root.is_dir() or root.stat().st_uid != os.getuid():
        raise ValueError("Invalid runtime owner")
    directory = root / "runtimes" / "inkling" / m["managed"]["engine"]["sha256"]
    for parent in [root / "runtimes", root / "runtimes" / "inkling", directory]:
        if parent.is_symlink() or parent.exists() and (not parent.is_dir() or parent.stat().st_uid != os.getuid()):
            raise ValueError("Unsafe engine directory")
    return directory


def installed_engine(root, m):
    """Re-hash the entire private engine tree, including dynamic libraries."""
    directory = engine_directory(root, m)
    receipt = directory / "hub-engine.json"
    if not receipt.exists():
        return None
    if directory.is_symlink() or receipt.is_symlink():
        raise ValueError("Unsafe engine directory")
    state = json.loads(receipt.read_text())
    if state["archiveSha256"] != m["managed"]["engine"]["sha256"]:
        raise ValueError("Engine pin changed")
    for item in state["files"]:
        f = directory / item["path"]
        if not f.is_relative_to(directory) or ".." in Path(item["path"]).parts or not f.resolve().is_relative_to(directory.resolve()) or not f.is_file():
            raise ValueError("Unsafe engine file")
        if (os.readlink(f) if f.is_symlink() else None) != item.get("symlink"):
            raise ValueError("Engine library link changed")
        with f.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise ValueError("Engine bytes changed")
    binary = directory / "llama-server"
    if not binary.is_file() or binary.is_symlink():
        raise ValueError("Engine binary missing")
    return binary


def ensure_engine(root, m, local_api, job):
    """Explicit apply only. PM handles durable ranges, hashes and archive safety."""
    if not compatible(m):
        raise ValueError("Unreviewed engine/model pair")
    binary = installed_engine(root, m)
    if binary:
        return binary
    from pm import Store, get_package
    store = Store(root / "runtimes" / "inkling")
    pin = m["managed"]["engine"]
    package = get_package("llamacpp-metal")
    with store.install_lock(), store.scratch() as scratch:
        archives = store.fetch_many([pin], scratch,
            progress=local_api._download_progress_hook(job),
            pause_event=local_api._RUNNING[job["job_id"]]["pause"])
        if archives[0].stat().st_size != pin["size_bytes"]:
            raise ValueError("Engine archive size changed")
        staged = scratch / "engine"
        staged.mkdir()
        package.unpack(archives[0], staged, "darwin-arm64")
        package.stage(store, staged, "12588", "darwin-arm64")
        reason = package.verify(staged, "darwin-arm64")
        if reason:
            raise ValueError("Engine executable or libraries failed verification")
        files = []
        for f in sorted(staged.rglob("*")):
            if f.is_symlink() and not f.resolve().is_relative_to(staged.resolve()):
                raise ValueError("Engine symlink escapes its private installation")
            if f.is_file():
                with f.open("rb") as stream:
                    files.append({"path": str(f.relative_to(staged)), "sha256": hashlib.file_digest(stream, "sha256").hexdigest(),
                                  **({"symlink": os.readlink(f)} if f.is_symlink() else {})})
        atomic_json(staged / "hub-engine.json", {"archiveSha256": pin["sha256"], "commit": pin["commit"], "files": files})
        store.publish(staged, pin["sha256"])
    return installed_engine(root, m)


def download_weights(m, entry, variant, local_api, job):
    from pm.downloader import Source, Download
    plan = local_api._download_plan(entry, variant)
    pins = m["catalog"]["variants"][0]["files"]
    if len(plan) != len(pins):
        raise ValueError("Unreviewed companion download")
    local_api._step(job, "downloading", "Downloading and verifying the pinned Inkling weights")
    sources = [Source(url, dest, pin["sha256"]) for (url, dest, size), pin in zip(plan, pins)]
    Download(sources, pause_event=local_api._RUNNING[job["job_id"]]["pause"]).run(
        progress=local_api._download_progress_hook(job))


def install_hooks(root, manifest):
    """Process-local hooks also loaded by the attested Hub gateway launcher.

    Existing models keep native Hermes engine selection, presets and growth.
    Inkling gets its own immutable engine and one fixed 65,536-token slot.
    """
    from hermes_cli import config as hconfig
    from hermes_cli.local_runtime import binaries, bootstrap, catalog, growth
    m = model(manifest)
    raw = m["catalog"]
    native_id = catalog._load_catalog({"schema_version": 3, "models": [raw]})[0].variants[0].model_id

    def selected():
        if _ENGINE_CHOICE.get() is not None:
            return _ENGINE_CHOICE.get() == native_id
        config = hconfig.load_config().get("model", {})
        return isinstance(config, dict) and config.get("provider") == "llamacpp" and config.get("default") == native_id

    old_engine = binaries.installed_engine
    old_presets = bootstrap._generate_presets
    old_max = bootstrap._admitted_models_max
    old_grow = growth.maybe_grow_window
    old_refit = bootstrap.refit_idle_presets
    old_stale = bootstrap._presets_stale

    def engine(backend="auto", **kwargs):
        if not selected():
            return old_engine(backend, **kwargs)
        binary = installed_engine(root, m)
        if binary is None:
            raise ValueError("Reviewed Inkling engine is not installed; use Hub model setup")
        return binaries.Engine("metal", "b12588", binary)

    def presets(mdir, preset_path, *args, **kwargs):
        if not selected():
            return old_presets(mdir, preset_path, *args, **kwargs)
        # One sequence and f16 KV; deliberately no MTP, vision, auto growth or
        # architecture-agnostic fitting. Loop applications are priced above.
        path = Path(mdir) / raw["variants"][0]["files"][0]["path"]
        if any(c in str(path) for c in "\r\n"):
            raise ValueError("Invalid model path")
        text = (f"[{native_id}]\nmodel = {path}\nctx-size = 65536\nparallel = 1\n"
                "cache-type-k = f16\ncache-type-v = f16\nn-gpu-layers = 99\n"
                "batch-size = 512\nubatch-size = 128\ntemp = 1.0\ntop-p = 1.0\ntop-k = 0\nmin-p = 0.0\n")
        preset_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        preset_path.write_text(text)
        return preset_path

    binaries.installed_engine = engine
    bootstrap._generate_presets = presets
    bootstrap._admitted_models_max = lambda *a, **kw: 1 if selected() else old_max(*a, **kw)
    growth.maybe_grow_window = lambda model_id, **kw: None if model_id == native_id else old_grow(model_id, **kw)
    bootstrap.refit_idle_presets = lambda sup: False if selected() else old_refit(sup)

    def stale():
        if not selected():
            return old_stale()
        from configparser import ConfigParser
        parser = ConfigParser()
        parser.read(binaries.runtimes_root() / "presets.ini")
        return not parser.has_section(native_id) or parser.getint(native_id, "ctx-size", fallback=0) != m["managed"]["contextTokens"]

    bootstrap._presets_stale = stale
    return m, native_id


def launch(root):
    """The copied controller invokes only this hash-attested module."""
    import runpy
    import sys
    receipt = json.loads((root / "receipt.json").read_text())
    manifest_file = root / "config" / "hermes-models.json"
    binding = receipt["modelRuntimeBinding"]
    if hashlib.sha256(manifest_file.read_bytes()).hexdigest() != binding["manifestSha256"]:
        raise ValueError("Runtime manifest changed")
    manifest = json.loads(manifest_file.read_text())
    if receipt["source"]["commit"] != manifest["hermesCommit"]:
        raise ValueError("Hermes source contract changed")
    install_hooks(root, manifest)
    sys.argv = ["gateway.run", "--config", str(Path(receipt.get("profile", {}).get("home", root / "data")) / "config.yaml")]
    runpy.run_module("gateway.run", run_name="__main__")
