"""No-weight fixtures for the optional instance-owned Inkling engine."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import Mock, patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


policy = load("inkling_policy_test", "scripts/setup/hermes-runtime.py")
bridge = load("inkling_bridge_test", "scripts/setup/hermes-models.py")
manifest = json.loads(Path("profiles/setup/hermes-models.json").read_text())
model = policy.model(manifest)
GIB = 1024**3


class ResourceTests(unittest.TestCase):
    def check(self, **kwargs):
        return policy.preflight(model, kwargs.pop("hw", {"ram_total_bytes": 64*GIB, "ram_available_bytes": 48*GIB}),
                                free=kwargs.pop("free", 64*GIB), missing_weights=kwargs.pop("missing_weights", 17629759456),
                                target=kwargs.pop("target", "darwin-arm64"), **kwargs)

    def test_matching_pair_and_complete_memory_accounting(self):
        r = self.check()
        self.assertEqual(r["prerequisites"], [])
        self.assertGreater(r["memory"]["contextCacheBytes"], 2*GIB)
        self.assertEqual(r["memory"]["runtimeOverheadBytes"], 4*GIB)
        self.assertEqual(r["memory"]["otherServicesBytes"], 16*GIB)
        self.assertGreater(r["memory"]["estimatedTotalBytes"], 32*GIB)
        self.assertFalse(r["memory"]["measured"])
        self.assertGreater(r["downloadBytes"], 17629759456)
        self.assertGreater(r["requiredBytes"], r["downloadBytes"]+2*GIB)

    def test_low_memory_disk_and_unsupported_platform_block(self):
        for kwargs, text in [
            ({"hw":{"ram_total_bytes":24*GIB,"ram_available_bytes":23*GIB}}, "32 GiB"),
            ({"hw":{"ram_total_bytes":64*GIB,"ram_available_bytes":10*GIB}}, "currently available"),
            ({"free": int(4.1*GIB)}, "free"),
            ({"target":"linux-x86_64"}, "Apple silicon"),
        ]:
            self.assertTrue(any(text in p for p in self.check(**kwargs)["prerequisites"]))

    def test_layout_context_and_engine_hash_cannot_silently_change(self):
        for mutate in [
            lambda m: m["managed"].update(layout="mainline"),
            lambda m: m["catalog"].update(architecture="inkling2_loop"),
            lambda m: m["managed"].update(contextTokens=32768),
            lambda m: m["managed"]["engine"].update(sha256="0"*64),
            lambda m: m["catalog"]["variants"][0]["files"][0].update(path="Mainline_Support/model.gguf_file"),
        ]:
            m = copy.deepcopy(model); mutate(m)
            self.assertFalse(policy.compatible(m))

    def test_resume_can_skip_verified_downloads_without_waiving_headroom(self):
        r=self.check(missing_weights=0, missing_engine=False)
        self.assertEqual(r["downloadBytes"],0)
        self.assertEqual(r["requiredBytes"],2*GIB)


class IntegrityTests(unittest.TestCase):
    def test_engine_tree_and_internal_library_links_are_attested(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=policy.engine_directory(root,model);directory.mkdir(parents=True)
            binary=directory/"llama-server";binary.write_bytes(b"fixture-only")
            library=directory/"lib.dylib";library.symlink_to(binary.name)
            row=lambda name,**kw: {"path":name,"sha256":hashlib.sha256(b"fixture-only").hexdigest(),**kw}
            (directory/"hub-engine.json").write_text(json.dumps({"archiveSha256":model["managed"]["engine"]["sha256"],"files":[row(binary.name),row(library.name,symlink=binary.name)]}))
            self.assertEqual(policy.installed_engine(root,model),binary)
            binary.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError,"bytes changed"):policy.installed_engine(root,model)

    def test_external_library_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=policy.engine_directory(root,model);directory.mkdir(parents=True)
            outside=root/"outside";outside.write_bytes(b"x")
            (directory/"llama-server").symlink_to(outside)
            (directory/"hub-engine.json").write_text(json.dumps({"archiveSha256":model["managed"]["engine"]["sha256"],"files":[{"path":"llama-server","sha256":hashlib.sha256(b"x").hexdigest(),"symlink":str(outside)}]}))
            with self.assertRaisesRegex(ValueError,"Unsafe"):policy.installed_engine(root,model)


class HookTests(unittest.TestCase):
    def test_old_choices_keep_native_engine_and_inkling_cannot_shrink_or_grow_context(self):
        cfg={"model":{"provider":"llamacpp","default":"Qwen3.5-4B-Q4_K_M"}}
        native_id=model["catalog"]["variants"][0]["files"][0]["path"][:-5]
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            binaries=types.SimpleNamespace(installed_engine=Mock(return_value="native-engine"),
                Engine=lambda *a:a,runtimes_root=lambda:root)
            bootstrap=types.SimpleNamespace(_generate_presets=Mock(return_value="native-preset"),
                _admitted_models_max=Mock(return_value=4),refit_idle_presets=Mock(return_value=True),_presets_stale=Mock(return_value=False))
            growth=types.SimpleNamespace(maybe_grow_window=Mock(return_value=131072))
            catalog=types.SimpleNamespace(_load_catalog=lambda d:[types.SimpleNamespace(variants=[types.SimpleNamespace(model_id=native_id)])])
            package=types.ModuleType("hermes_cli");package.__path__=[]
            package.config=types.SimpleNamespace(load_config=lambda:copy.deepcopy(cfg))
            runtime=types.ModuleType("hermes_cli.local_runtime");runtime.__path__=[]
            runtime.binaries=binaries;runtime.bootstrap=bootstrap;runtime.catalog=catalog;runtime.growth=growth
            with patch.dict(sys.modules,{"hermes_cli":package,"hermes_cli.local_runtime":runtime}):
                policy.install_hooks(root,manifest)
                self.assertEqual(binaries.installed_engine(),"native-engine")
                self.assertEqual(bootstrap._generate_presets(root,root/"presets.ini"),"native-preset")
                cfg["model"]["default"]=native_id
                with patch.object(policy,"installed_engine",return_value=root/"private/llama-server"):
                    self.assertEqual(binaries.installed_engine()[2],root/"private/llama-server")
                    preset=bootstrap._generate_presets(root,root/"presets.ini")
                    self.assertIn("ctx-size = 65536",preset.read_text())
                    self.assertIn("parallel = 1",preset.read_text())
                    self.assertIn("cache-type-k = f16",preset.read_text())
                    self.assertFalse(bootstrap.refit_idle_presets(None))
                    self.assertIsNone(growth.maybe_grow_window(native_id))
                    self.assertFalse(bootstrap._presets_stale())
                    with policy.engine_choice("Qwen3.5-4B-Q4_K_M"):
                        self.assertEqual(binaries.installed_engine(),"native-engine")
                        self.assertEqual(bootstrap._generate_presets(root,root/"presets.ini"),"native-preset")
                    self.assertEqual(binaries.installed_engine()[2],root/"private/llama-server")


class JobTests(unittest.TestCase):
    def test_new_model_is_retained_only_after_inference_and_actual_context_pass(self):
        cases = [("Darwin","arm64",65536,True,True), ("Darwin","arm64",32768,True,False),
                 ("Darwin","arm64",65536,False,False), ("Linux","x86_64",65536,True,False)]
        for system,machine,ctx,ready,success in cases:
            with self.subTest(system=system,ctx=ctx,ready=ready), tempfile.TemporaryDirectory() as temp:
                root=Path(temp);saved={"model":{"provider":"custom","default":"old-model"},"mcp_servers":{"keep":{}}}
                prior=copy.deepcopy(saved)
                def save(cfg):saved.clear();saved.update(copy.deepcopy(cfg))
                config=types.SimpleNamespace(load_config=lambda:copy.deepcopy(saved),save_config=save)
                native_id=model["catalog"]["variants"][0]["files"][0]["path"][:-5]
                variant=types.SimpleNamespace(model_id=native_id)
                entry=types.SimpleNamespace(variants=[variant])
                sup=types.SimpleNamespace(ensure_model_ready=Mock(return_value=ready),
                    _request=Mock(return_value={"default_generation_settings":{"n_ctx":ctx}}))
                boot=types.SimpleNamespace(models_dir=lambda:root,assets_dir=lambda:root,
                    get_supervisor=lambda:sup,shutdown_local_runtime=Mock())
                pending=[]
                api=types.SimpleNamespace(_QUICKSTART_LOCK=threading.Lock(),_job=lambda *a,**kw:{"job_id":"fixture"},
                    _step=Mock(),_run_download_plan=Mock(),_download_plan=lambda *a:[],
                    _stop_server=Mock(),_ensure_server=Mock(),_finish=Mock(),
                    _spawn_job=lambda job,name,run,**kw:pending.append((run,kw["on_exit"])),
                    local_models_hardware=lambda:{"ram_total_bytes":64*GIB,"ram_available_bytes":48*GIB})
                modules={"hermes_cli":types.ModuleType("hermes_cli"),"hermes_cli.local_runtime":types.ModuleType("hermes_cli.local_runtime"),
                         "hermes_cli.local_runtime.endpoint":types.SimpleNamespace(child_query=lambda x:"model="+x)}
                modules["hermes_cli.local_runtime"].catalog=types.SimpleNamespace(catalog_by_id=lambda:{model["id"]:entry})
                with patch.dict(sys.modules,modules),patch.object(policy.platform,"system",return_value=system),patch.object(policy.platform,"machine",return_value=machine),patch.object(bridge,"runtime_policy",return_value=policy),patch.object(policy,"ensure_engine",return_value=root/"engine"),patch.object(policy,"download_weights"),patch.object(bridge.shutil,"disk_usage",return_value=types.SimpleNamespace(free=64*GIB)):
                    bridge.start_inkling(root,manifest,api,config,boot,Mock())
                    self.assertEqual(saved,prior)
                    run,release=pending[0]
                    try:
                        if success: run()
                        else:
                            expected = "Apple silicon" if system != "Darwin" else "64,000 tokens" if ctx < policy.MIN_CONTEXT else "inference readiness"
                            with self.assertRaisesRegex(ValueError,expected):run()
                    finally:release()
                    if success:
                        self.assertEqual(saved["model"]["default"],native_id)
                        self.assertEqual(saved["model"]["context_length"],65536)
                        self.assertEqual(saved["mcp_servers"],{"keep":{}})
                    else:
                        self.assertEqual(saved,prior)
                        api._finish.assert_not_called()
                        boot.shutdown_local_runtime.assert_called_once()


if __name__=="__main__":unittest.main()
