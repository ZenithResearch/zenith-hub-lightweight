#!/usr/bin/env python3
"""Private Hub adapter over the installed Hermes provider and local-model APIs.

Runs only on an owner-private Unix socket. It does not mount Hermes's dashboard,
PTY, file browser, or cron lifespan. Provider auth and model setup stay in Hermes.
"""
import argparse
import asyncio
import hashlib
import hmac
import importlib.util
import copy
import json
import os
from pathlib import Path
import shutil
import sys

PROTOCOL = "zenith.hermes-model-manager.v1"

_POLICY = None


def runtime_policy():
    global _POLICY
    if _POLICY is not None:
        return _POLICY
    spec = importlib.util.spec_from_file_location("hub_hermes_runtime", Path(__file__).with_name("hermes-runtime.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _POLICY = module
    return module


def start_inkling(root, manifest, local_api, hconfig, bootstrap, verify):
    """Native resumable job, explicit engine upgrade, rollback before activation on failure."""
    policy = runtime_policy()
    m = policy.model(manifest)
    from hermes_cli.local_runtime import catalog
    entry = catalog.catalog_by_id()[m["id"]]
    variant = entry.variants[0]
    if not local_api._QUICKSTART_LOCK.acquire(blocking=False):
        raise ValueError("Another local setup is running")
    job = local_api._job("quickstart", m["name"], model_id=m["id"])

    def run_inner():
        local_api._step(job, "installing-runtime", "Installing the reviewed instance-only Inkling engine")
        policy.ensure_engine(root, m, local_api, job)
        policy.download_weights(m, entry, variant, local_api, job)
        verify(m["catalog"], bootstrap.models_dir(), bootstrap.assets_dir())
        # A failed qualification never leaves the selected model changed.
        prior = copy.deepcopy(hconfig.load_config())
        try:
            local_api._stop_server()  # verifies native ownership; never stops a foreign server
            live = policy.preflight(m, local_api.local_models_hardware(),
                free=shutil.disk_usage(bootstrap.models_dir()).free, missing_weights=0, missing_engine=False)
            if live["prerequisites"]:
                raise ValueError("; ".join(live["prerequisites"]))
            cfg = copy.deepcopy(prior)
            cfg.setdefault("model", {}).update(provider="llamacpp", default=variant.model_id)
            cfg["model"].pop("base_url", None)
            cfg["model"].pop("key_env", None)
            cfg["model"].pop("api_key", None)
            cfg["model"]["context_length"] = m["managed"]["contextTokens"]
            cfg.setdefault("local_runtime", {})["enabled"] = True
            hconfig.save_config(cfg)
            local_api._ensure_server(job, cfg, variant.model_id,
                fail_detail="Inkling server did not start", skip_msg="Inkling rescan")
            sup = bootstrap.get_supervisor()
            if sup is None or not sup.ensure_model_ready(variant.model_id):
                raise ValueError("Inkling did not pass inference readiness")
            from hermes_cli.local_runtime.endpoint import child_query
            props = sup._request("/props?" + child_query(variant.model_id))
            actual = props.get("default_generation_settings", {}).get("n_ctx", 0)
            if actual < policy.MIN_CONTEXT:
                raise ValueError("Inkling server does not actually serve at least 64,000 tokens")
            local_api._finish(job, "Inkling is ready; configuration remains experimental, not a quality recommendation")
        except Exception:
            bootstrap.shutdown_local_runtime()
            hconfig.save_config(prior)
            raise

    def run():
        with policy.engine_choice(variant.model_id):
            run_inner()

    local_api._spawn_job(job, "hub-inkling", run, fail_msg="Inkling setup failed: %s",
        on_exit=local_api._QUICKSTART_LOCK.release, resumable=True)
    return {"job_id": job["job_id"], "model_id": m["id"]}


def public_error(message="Hermes could not complete this action. Check the connection and try again."):
    return {"error": "hermes_model_action_failed", "message": message}


def validate_root(root: Path) -> dict:
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError("Invalid instance directory")
    for p in (root, root / "receipt.json"):
        if p.is_symlink():
            raise ValueError("Instance files must not be symlinks")
        st = p.stat()
        if st.st_uid != os.getuid() or st.st_mode & 0o077:
            raise ValueError("Instance is not private")
    receipt = json.loads((root / "receipt.json").read_text())
    if receipt.get("componentId") != "hermes" or receipt.get("installed") is not True:
        raise ValueError("Hermes is not installed")
    return receipt


def checked_text(value, *, maximum=240, required=True):
    if not isinstance(value, str) or len(value) > maximum or any(c in value for c in "\x00\n\r") or required and not value.strip():
        raise ValueError("Invalid value")
    return value.strip()


def verify_model_artifacts(raw: dict, models_dir: Path, assets_dir: Path):
    # Hermes flattens repository subdirectories into local filenames, including
    # split GGUF shards. Verify every part at its actual download destination.
    files = [(models_dir, f) for f in raw["variants"][0]["files"]]
    if raw.get("mmproj"):
        files.append((assets_dir, raw["mmproj"]))
    for directory, pin in files:
        name = pin.get("local") or Path(pin["path"]).name
        if Path(name).name != name:
            raise ValueError("Invalid local model filename")
        file = directory / name
        if file.is_symlink() or not file.is_file() or file.stat().st_size != pin["size_bytes"]:
            raise ValueError("A downloaded model file is incomplete")
        with file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != pin["sha256"]:
                raise ValueError("A downloaded model file differs from its reviewed hash")


def load_native(root: Path, manifest: dict):
    receipt = validate_root(root)
    if receipt.get("source", {}).get("commit") != manifest["hermesCommit"]:
        raise ValueError("Hermes source differs from the supported contract")
    sys.path.insert(0, receipt.get("software", {}).get("source", str(root / "source")))
    from hermes_cli import web_server as ws
    from hermes_cli import config as hconfig
    from hermes_cli.provider_catalog import provider_catalog
    from hermes_cli.web_routers import config_env, models, oauth, local_models
    from hermes_cli.local_runtime import catalog, hardware, bootstrap
    # Keep the supplemental suggestions release-owned, without modifying Hermes's
    # installed source or allowing its asynchronous catalog refresh to replace them.
    supplemental = catalog._load_catalog({"schema_version": 3, "models": [m["catalog"] for m in manifest["models"]]})
    ids = {e.id for e in supplemental}
    catalog.CATALOG = tuple(e for e in catalog.CATALOG if e.id not in ids) + supplemental
    catalog.refresh_catalog_soon = lambda: None
    original_ensure = local_models._ensure_server
    by_variant = {e.variants[0].model_id: m for e, m in zip(supplemental, manifest["models"])}

    def verified_ensure(job, config, model_id, **kwargs):
        entry = by_variant.get(model_id)
        if entry:
            raw = entry["catalog"]
            verify_model_artifacts(raw, bootstrap.models_dir(), bootstrap.assets_dir())
        current = hconfig.load_config().get("model", {})
        if isinstance(current, dict) and current.get("default") != model_id and any(
                k == current.get("default") for k, v in by_variant.items() if v.get("managed")):
            local_models._stop_server()
            config = local_models._set_runtime_enabled(True)
        return original_ensure(job, config, model_id, **kwargs)

    local_models._ensure_server = verified_ensure
    runtime_policy().install_hooks(root, manifest)
    return ws, hconfig, provider_catalog, config_env, models, oauth, local_models, catalog, hardware, bootstrap


class DefaultAPIConflict(ValueError):
    pass


def configure_api(hconfig, root: Path, port):
    """Merge only Hub API settings into Hermes's current/default configuration."""
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("Invalid API port")
    secrets = json.loads((root / "data/hub-secrets.json").read_text())
    key = checked_text(secrets.get("API_SERVER_KEY"), maximum=256)
    cfg = copy.deepcopy(hconfig.load_config())
    api = cfg.setdefault("platforms", {}).setdefault("api_server", {})
    if api.get("enabled") and api.get("extra", {}).get("key") != key:
        raise DefaultAPIConflict("Default Hermes API belongs to another connection")
    api["enabled"] = True
    api.setdefault("extra", {}).update(host="127.0.0.1", port=port, key=key)
    cfg.setdefault("platform_toolsets", {})["api_server"] = []
    hconfig.save_config(cfg)
    return {"configured": True}


def create_app(root: Path, manifest: dict, token: str, identity: str):
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse
    ws, hconfig, provider_catalog, env_api, model_api, oauth_api, local_api, catalog, hardware, bootstrap = load_native(root, manifest)
    from hermes_cli.web_models import EnvVarUpdate
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    descriptors = {p.slug: p for p in provider_catalog()}
    suggestions = {m["id"]: m for m in manifest["models"]}
    account_cards = {p["id"]: p for p in oauth_api._build_oauth_catalog()}
    allowed = {"ping", "options", "models", "connect-key", "oauth-start", "oauth-poll", "oauth-cancel", "local-preflight", "local-start", "local-job", "local-pause", "local-resume", "apply-backend", "configure-api"}

    def configuration():
        cfg = hconfig.load_config().get("model", {})
        if not isinstance(cfg, dict):
            cfg = {"default": str(cfg)}
        return {"providerId": cfg.get("provider", "custom"), "modelName": cfg.get("default", ""),
                "modelEndpoint": cfg.get("base_url", ""), "contextLength": cfg.get("context_length")}

    def suggestion_rows(hw=None):
        budget = hardware.probe_budget(planning=True)
        rows = []
        for ident, m in suggestions.items():
            entry = catalog.catalog_by_id()[ident]
            raw = m["catalog"]
            if m.get("managed"):
                policy = runtime_policy()
                estimate = policy.preflight(m, hw if hw is not None else local_api.local_models_hardware(), free=2**63, missing_weights=0, missing_engine=False)
                priced = {"fits": not estimate["prerequisites"], "start_window": m["managed"]["contextTokens"],
                          "fit_summary": "; ".join(estimate["prerequisites"]) or "Experimental 65,536-token configuration; memory estimate is not measured"}
            else:
                priced = local_api._catalog_row(entry, budget, None, None, set(bootstrap.staged_model_ids()))
            files = raw["variants"][0]["files"]
            total = sum(f["size_bytes"] for f in files) + raw.get("mmproj", {}).get("size_bytes", 0)
            rows.append({"id": ident, "name": m["name"], "tier": m["tier"], "machineLabel": m["machineLabel"],
                         "description": m["description"], "modelCard": m["modelCard"], "downloadBytes": total,
                         "fits": priced.get("fits", False), "fitSummary": priced.get("fit_summary", "Not estimated"),
                         "contextLength": priced.get("start_window", 65536), "spilled": priced.get("spilled", False),
                         "downloaded": priced.get("downloaded", False), "modelName": entry.variants[0].model_id,
                         **({"publisher": m["publisher"], "quantizationPublisher": m["quantizationPublisher"], "quantization": raw["variants"][0]["quant"],
                             "qualification": m["qualification"]["status"], "engine": m["managed"]["engine"]["release"],
                             "memoryEstimateBytes": estimate["memory"]["estimatedTotalBytes"], "managedNote": m["managed"]["reason"]} if m.get("managed") else {})})
        fitting = [r for r in rows if r["fits"] and not r["spilled"] and suggestions[r["id"]]["catalog"].get("recommend", True)]
        # Editorial size bands; memory feasibility and window are Hermes's.
        picked = fitting[-1]["id"] if fitting else None
        for row in rows:
            row["recommended"] = row["id"] == picked
        return rows

    async def options():
        stored_env = hconfig.load_env()
        providers = []
        for ident, d in descriptors.items():
            if ident in {"auto", "custom", "moa", "llamacpp"}:
                continue
            card = account_cards.get(ident, {})
            flow = card.get("flow", "api_key" if d.api_key_env_vars else "external")
            signed_in = False
            if flow == "device_code":
                try:
                    status = oauth_api._resolve_provider_status(ident, card.get("status_fn"))
                    signed_in = status.get("logged_in") is True
                except Exception:
                    pass
            providers.append({"id": ident, "name": d.label, "description": d.description,
                              "authType": "account" if flow == "device_code" else "api_key" if d.api_key_env_vars else "external",
                              "credentialConfigured": any(bool(stored_env.get(k)) for k in d.api_key_env_vars) or signed_in,
                              "signedIn": signed_in, "supportsApiKey": bool(d.api_key_env_vars),
                              "supportsSignIn": flow == "device_code", "signupUrl": d.signup_url or card.get("docs_url", "")})
        hw = await asyncio.to_thread(local_api.local_models_hardware)
        local = await asyncio.to_thread(suggestion_rows, hw)
        return {"protocol": PROTOCOL, "identity": identity, "providers": providers, "localModels": local,
                "hardware": {k: hw.get(k) for k in ("ram_total_bytes", "ram_available_bytes", "vram_total_bytes", "uma", "gpu_name")},
                "configuration": configuration(), "modelsDirectory": str(bootstrap.models_dir()),
                "jobs": (await local_api.local_models_jobs()).get("jobs", []), "note": manifest["recommendationNote"]}

    def local_preflight(ident):
        if ident not in suggestions:
            raise ValueError("Unknown local model")
        hw = local_api.local_models_hardware()
        row = next(r for r in suggestion_rows(hw) if r["id"] == ident)
        e = catalog.catalog_by_id()[ident]
        variant = e.variants[0]
        needed = sum(size for _url, file, size in local_api._download_plan(e, variant) if not file.is_file() or file.stat().st_size != size)
        directory = bootstrap.models_dir()
        parent = directory
        while not parent.exists():
            parent = parent.parent
        free = shutil.disk_usage(parent).free
        required = needed + 2 * 1024**3
        problems = []
        if not row["fits"]:
            problems.append("This model does not fit the machine's current memory budget.")
        if free < required:
            problems.append(f"Free at least {required / 1024**3:.1f} GB on the model volume ({free / 1024**3:.1f} GB available).")
        if suggestions[ident].get("managed"):
            policy = runtime_policy()
            m = suggestions[ident]
            if needed == 0:
                try:
                    verify_model_artifacts(m["catalog"], directory, bootstrap.assets_dir())
                except ValueError:
                    needed = sum(f["size_bytes"] for f in m["catalog"]["variants"][0]["files"])
            info = policy.preflight(m, hw, free=free, missing_weights=needed,
                                    missing_engine=policy.installed_engine(root, m) is None)
            if not directory.resolve().is_relative_to(root.resolve()):
                info["prerequisites"].append("Managed Inkling weights must belong to this private Hermes instance. Use an existing-server connection for externally owned storage.")
            return {**info, "model": row, "modelsDirectory": str(directory),
                    "engineDirectory": str(policy.engine_directory(root, m)), "artifacts": m["catalog"],
                    "source": {"publisher": m["publisher"], "quantizationPublisher": m["quantizationPublisher"],
                               "repository": m["catalog"]["repo"], "revision": m["catalog"]["variants"][0]["files"][0]["revision"]},
                    "quantization": m["catalog"]["variants"][0]["quant"], "notice": m["notice"],
                    "effects": ["Install the separate pinned Unsloth engine in this instance; keep the existing Hermes engine.",
                                "Download and verify text-only weights; no vision projector or speculative drafter.",
                                "Restart only this instance's owned local model server; test inference and actual served context before retaining the new model."]}
        tag, backend = local_api._runtime_target()
        return {"model": row, "downloadBytes": needed, "requiredBytes": required, "availableBytes": free,
                "modelsDirectory": str(directory), "engine": {"release": tag, "backend": backend},
                "prerequisites": problems, "artifacts": suggestions[ident]["catalog"]}

    @app.post("/request")
    async def request_action(request: Request):
        if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        secret = ""
        try:
            raw = await request.body()
            if len(raw) > 32768:
                raise ValueError("Request too large")
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("action") not in allowed:
                raise ValueError("Unknown action")
            action = data["action"]
            if action == "ping":
                return {"protocol": PROTOCOL, "identity": identity}
            if action == "options":
                return await options()
            if action in {"models", "connect-key", "oauth-start", "oauth-poll"}:
                provider = checked_text(data.get("providerId"), maximum=90)
                if provider not in descriptors:
                    raise ValueError("Unknown provider")
            if action == "models":
                payload = await model_api.get_model_options(include_unconfigured=True, explicit_only=True, refresh=True)
                group = next((p for p in payload.get("providers", []) if p.get("slug") == provider), {})
                models = [m for m in group.get("models", []) if isinstance(m, str)][:1000]
                try:
                    preferred = await asyncio.to_thread(model_api.get_recommended_default_model, provider)
                except Exception:
                    preferred = {}
                current = configuration()
                return {"providerId": provider, "models": models,
                        "recommendedModel": preferred.get("model", "") if preferred.get("model") in models else "",
                        "currentModel": current["modelName"] if current["providerId"] == provider else ""}
            if action == "connect-key":
                d = descriptors[provider]
                if not d.api_key_env_vars:
                    raise ValueError("This provider uses account sign-in")
                secret = checked_text(data.get("apiKey"), maximum=16384)
                key = d.api_key_env_vars[0]
                probe_key = "GEMINI_API_KEY" if provider == "gemini" else key
                probe = await env_api.validate_provider_credential(EnvVarUpdate(key=probe_key, value=secret), request)
                if probe.get("reachable") and not probe.get("ok"):
                    return JSONResponse(public_error("The provider rejected this key. Check it and try again."), status_code=409)
                await env_api.set_env_var(EnvVarUpdate(key=key, value=secret, provider_setup=True))
                return {"providerId": provider, "credentialConfigured": True, "verified": bool(probe.get("reachable") and probe.get("ok"))}
            if action == "oauth-start":
                card = account_cards.get(provider, {})
                if card.get("flow") != "device_code":
                    raise ValueError("This provider requires its own sign-in client or an API key")
                started = await oauth_api.start_oauth_login(provider, request)
                return {k: started.get(k) for k in ("session_id", "flow", "user_code", "verification_url", "expires_in", "poll_interval")}
            if action == "oauth-poll":
                session = checked_text(data.get("sessionId"), maximum=160)
                result = await oauth_api.poll_oauth_session(provider, session)
                return {k: result.get(k) for k in ("session_id", "status", "expires_at", "reason")}
            if action == "oauth-cancel":
                return await oauth_api.cancel_oauth_session(checked_text(data.get("sessionId"), maximum=160), request)
            if action == "local-preflight":
                return await asyncio.to_thread(local_preflight, checked_text(data.get("modelId"), maximum=90))
            if action == "local-start":
                ident = checked_text(data.get("modelId"), maximum=90)
                ready = await asyncio.to_thread(local_preflight, ident)
                if ready["prerequisites"]:
                    return JSONResponse({"error": "local_model_prerequisites", "prerequisites": ready["prerequisites"]}, status_code=409)
                if suggestions[ident].get("managed"):
                    return await asyncio.to_thread(start_inkling, root, manifest, local_api, hconfig, bootstrap, verify_model_artifacts)
                def start_native():
                    entry = catalog.catalog_by_id()[ident]
                    with runtime_policy().engine_choice(entry.variants[0].model_id):
                        return local_api.local_models_quickstart(local_api.QuickstartBody(model_id=ident))
                return await asyncio.to_thread(start_native)
            if action in {"local-job", "local-pause", "local-resume"}:
                job = checked_text(data.get("jobId"), maximum=90)
                if action == "local-pause":
                    return await local_api.local_models_download_pause(local_api.JobIdBody(job_id=job))
                if action == "local-resume":
                    return await local_api.local_models_download_resume(local_api.JobIdBody(job_id=job))
                row = await local_api.local_models_job(job)
                return {"job": row, "configuration": configuration() if row.get("status") == "done" else None}
            if action == "configure-api":
                return configure_api(hconfig, root, data.get("apiPort"))
            if action == "apply-backend":
                from hermes_cli.web_models import ModelAssignment
                provider = checked_text(data.get("providerId"), maximum=90)
                if provider not in descriptors and provider not in {"custom", "llamacpp"}:
                    raise ValueError("Unknown provider")
                prior_model = hconfig.load_config().get("model", {})
                prior_base = prior_model.get("base_url", "") if isinstance(prior_model, dict) else ""
                result = await model_api.set_model_assignment(ModelAssignment(scope="main", provider=provider,
                    model=checked_text(data.get("modelName"), maximum=240), base_url=data.get("baseUrl", ""),
                    confirm_expensive_model=True))
                if result.get("ok") is False:
                    return JSONResponse(public_error("Hermes could not select that model. Refresh its available models."), status_code=409)
                cfg = hconfig.load_config()
                # Apply the explicitly reviewed main-slot binding as well as the native
                # assignment. A native config cache must not restore the prior endpoint.
                main = cfg.setdefault("model", {})
                main["provider"] = provider
                main["default"] = data["modelName"]
                if provider == "custom":
                    main["base_url"] = data.get("baseUrl", "")
                elif provider != "llamacpp":
                    main.pop("base_url", None)
                if provider != "custom" or data.get("baseUrl", "") != prior_base:
                    cfg["model"].pop("key_env", None)
                    cfg["model"].pop("api_key", None)
                if provider == "custom" and data.get("useHubKey"):
                    private_env = json.loads((root / "data/hub-secrets.json").read_text())
                    os.environ["HUB_MODEL_API_KEY"] = private_env["HUB_MODEL_API_KEY"]
                    cfg["model"]["key_env"] = "HUB_MODEL_API_KEY"
                else:
                    os.environ.pop("HUB_MODEL_API_KEY", None)
                    if cfg["model"].get("key_env") == "HUB_MODEL_API_KEY":
                        cfg["model"].pop("key_env", None)
                if data.get("contextLength") and provider == "custom":
                    cfg["model"]["context_length"] = int(data["contextLength"])
                elif provider != "llamacpp":
                    cfg["model"].pop("context_length", None)
                if data.get("apiPort"):
                    cfg.setdefault("platforms", {}).setdefault("api_server", {}).setdefault("extra", {})["port"] = int(data["apiPort"])
                hconfig.save_config(cfg)
                return {"configuration": configuration()}
        except DefaultAPIConflict:
            return JSONResponse({"error": "hermes_default_api_in_use", "message": "Hermes already has an API configured for another connection. Connect to that service or release its API configuration before starting another."}, status_code=409)
        except HTTPException:
            return JSONResponse(public_error(), status_code=409)
        except Exception:
            # No request body, credential, OAuth token or raw provider exception is echoed.
            return JSONResponse(public_error(), status_code=409)

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--identity", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    token = os.environ.get("HERMES_DASHBOARD_SESSION_TOKEN", "")
    if len(token) < 32:
        raise ValueError("A private manager credential is required")
    manifest = json.loads(args.manifest.read_text())
    app = create_app(args.root, manifest, token, args.identity)
    import uvicorn
    uvicorn.run(app, uds=args.socket, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
