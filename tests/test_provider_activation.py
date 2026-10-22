import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock


SOURCE = Path(__file__).parents[1] / "profiles/process-macos/process_mac.py"
SPEC = importlib.util.spec_from_file_location("process_mac", SOURCE)
process_mac = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(process_mac)


def private_file(path: Path, value: dict) -> bytes:
    raw = process_mac.workspace_bytes(value)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(raw)
    path.chmod(0o600)
    return raw


class ProviderActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve() / "Process-Workspace"
        self.root.mkdir(mode=0o700)
        for name in ("config", "data", "logs", "authority", "native"):
            (self.root / name).mkdir(mode=0o700)
        private_file(self.root / "config/workspace-admission.json",
                     {"schema": "runtime.new-run-admission.v1", "enabled": False,
                      "composition_digest": "0" * 64})
        self.previous = self.root / "authority/COMPLETE.json"
        self.previous_raw = private_file(self.previous, {"receipt": "existing"})
        self.rows = [
            {"role": "wallet-command", "filename": "castalia-wallet-service", "sha256": "a" * 64},
            {"role": "context-verifier", "filename": "process-runtime-secs-check", "sha256": "b" * 64},
        ]
        self.receipt = {"identity_not_after": int(time.time()) + 86400}
        self.patches = mock.patch.multiple(
            process_mac,
            workspace_holds=mock.Mock(return_value=False),
            workspace_stopped=mock.Mock(),
            workspace_ready=mock.Mock(return_value=self.receipt),
            workspace_selected=mock.Mock(return_value=(self.previous, None)),
            workspace_profile=mock.Mock(return_value={}),
            native_rows=mock.Mock(return_value=self.rows),
        )
        self.patches.start()

    def tearDown(self):
        self.patches.stop()
        self.temp.cleanup()

    def test_base_start_does_not_require_independent_projection(self):
        report = {"components": {
            "runtime": {"managed": True, "live": True, "ready": False},
            "service": {"managed": True, "live": True, "ready": False},
            "provider-projection": {"managed": False, "live": False, "ready": False},
        }}
        self.assertTrue(process_mac.base_components_started_default_deny(report))
        report["components"]["service"]["live"] = False
        self.assertFalse(process_mac.base_components_started_default_deny(report))

    def test_provider_runtime_plan_binds_one_actor_and_run(self):
        handoff_id = "a" * 64
        run_id = "handoff-" + handoff_id[:48]
        proposal = process_mac.workspace_prepare_renewal(
            self.root, actor_id="frank-anima", run_id=run_id, handoff_id=handoff_id
        )
        raw, plan = process_mac.workspace_renewal_plan(self.root, proposal["plan_sha256"])
        self.assertEqual(plan["schema"], "castalia.wallet-workspace-live-provider-authority.v1")
        self.assertEqual(plan["actor_id"], "frank-anima")
        self.assertEqual(plan["run_id"], run_id)
        self.assertEqual(plan["handoff_id"], handoff_id)
        self.assertEqual(proposal["permission_count"], 23)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), proposal["plan_sha256"])
        with self.assertRaises(process_mac.InstallError):
            process_mac.workspace_prepare_renewal(self.root, actor_id="frank-anima")

    def test_provider_service_setup_recovers_exact_complete_without_reissue(self):
        proposal = process_mac.workspace_prepare_provider_service(self.root)
        plan_pin = proposal["plan_sha256"]
        calls = []

        def native(argv, root):
            calls.append(tuple(map(str, argv)))
            config = self.root / "authority/provider-service/1/config"
            values = {
                "command-authority.json": {"command": True},
                "wallet-command.json": {"wallet": True},
                "service-receiver.json": {"receiver": True},
            }
            hashes = {}
            for name, value in values.items():
                hashes[name] = hashlib.sha256(private_file(config / name, value)).hexdigest()
            receipt = {
                "schema": "castalia.wallet-provider-service-authority-complete.v1",
                "plan_sha256": plan_pin,
                "root": str(self.root),
                "generation": 1,
                "configuration_hashes": hashes,
                "not_before": int(time.time()) - 5,
                "not_after": int(time.time()) + 3500,
                "scope": "finite local provider lifecycle authority in one isolated Service Management store",
                "activation": False,
                "service_started": False,
            }
            private_file(self.root / "authority/provider-service/1/COMPLETE.json", receipt)
            return {
                "schema": "castalia.wallet-provider-service-authority-output.v1",
                "status": "configured_not_activated",
                "root": str(self.root),
                "generation": 1,
            }

        with mock.patch.object(process_mac, "workspace_run", side_effect=native):
            first = process_mac.workspace_provider_service_setup(self.root, plan_pin)
            second = process_mac.workspace_provider_service_setup(self.root, plan_pin)
        self.assertFalse(first["provider_enabled"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(len(calls), 1)
        status = process_mac.workspace_provider_service_status(self.root)
        self.assertEqual(status["state"], "configured_native_unqualified")
        self.assertEqual(status["generation"], 1)

    def test_partial_provider_service_authority_is_never_replayed(self):
        proposal = process_mac.workspace_prepare_provider_service(self.root)
        (self.root / "authority/provider-service/1").mkdir(mode=0o700, parents=True)
        with mock.patch.object(process_mac, "workspace_run") as native:
            with self.assertRaises(process_mac.InstallError):
                process_mac.workspace_provider_service_setup(
                    self.root, proposal["plan_sha256"]
                )
        native.assert_not_called()

    def test_live_provider_identity_check_rejects_changed_run(self):
        holder = {
            "schema": "identity", "store_id": "store", "subject_id": "subject",
            "purpose": "runtime", "application": "runtime", "key_generation": 1,
            "key_id": "key", "public_key_hex": "01", "public_key_sha256": "02",
            "created_at": 1, "key_created_at": 1, "not_before": 1,
            "not_after": 9999999999, "state": "active", "revoked_at": None,
            "state_revision": 1,
        }
        old = {"holder": holder, "command_issuer": {"key": "issuer"},
               "identity_not_after": 9999999999,
               "journal_capacity": "local_review_pilot_512", "scope": "authoring"}
        handoff_id = "a" * 64
        run_id = "handoff-" + handoff_id[:48]
        new = {**old, "holder": {**holder, "state_revision": 2},
               "scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
               "actor_id": "frank-anima", "run_id": run_id, "handoff_id": handoff_id}
        plan = {"schema": "castalia.wallet-workspace-live-provider-authority.v1",
                "actor_id": "frank-anima", "run_id": run_id, "handoff_id": handoff_id}
        process_mac.workspace_renewal_identity(old, new, plan)
        with self.assertRaises(process_mac.InstallError):
            process_mac.workspace_renewal_identity(old, {**new, "run_id": "run-2"}, plan)

    def test_provider_admission_dispatches_one_item_with_exact_policy(self):
        policy = private_file(
            self.root / "config/provider-requester-policy.json",
            {"schema": "service.castalia-requester-policy.v1", "allowed": ["did:castalia:member:test"]},
        )
        policy_pin = hashlib.sha256(policy).hexdigest()
        service_receipt = {
            "configuration_hashes": {"wallet-command.json": "c" * 64}
        }
        result = {
            "schema": "service.provider-worker-result.v1",
            "command": "admit-once",
            "processed": 1,
            "results": [{"request_id": "req-1"}],
        }
        with mock.patch.object(
            process_mac,
            "workspace_provider_service_status",
            return_value={"state": "configured_native_unqualified", "permission": {"state": "active"}},
        ), mock.patch.object(
            process_mac, "workspace_provider_service_receipt", return_value=service_receipt
        ), mock.patch.object(process_mac, "workspace_run", return_value=result) as run:
            observed = process_mac.workspace_provider_worker(
                self.root, "workspace-provider-admit-once", policy_pin
            )
        self.assertEqual(observed, result)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertIn("--requester-policy", argv)
        self.assertEqual(argv[argv.index("--limit") + 1], "1")
        self.assertEqual(argv[argv.index("--intake-database") + 1], str(self.root / "data/provider-intake.db"))
        self.assertEqual(argv[argv.index("--service-database") + 1], str(self.root / "data/service.db"))
        self.assertNotIn("--runtime-endpoint", argv)

    def test_provider_pull_dispatches_one_item_with_fixed_route_and_private_token(self):
        self.rows.append({
            "role": "provider-intake-opener", "filename": "secs-provider-intake-v1",
            "sha256": "e" * 64,
        })
        pull = private_file(
            self.root / "config/provider-pull.json",
            {"schema": "hub.provider-pull.v1", "region": "sfo1",
             "topic": "zenith-intake-v1", "consumer_group": "zenith-provider-mac",
             "lease_seconds": 300},
        )
        token = self.root / "config/provider-vercel-oidc-token"
        token.write_text("header.payload.signature\n")
        token.chmod(0o600)
        result = {"schema": "service.provider-worker-result.v1", "command": "pull-once",
                  "processed": 1, "results": [{"request_id": "req-1"}]}
        with mock.patch.object(process_mac, "workspace_run", return_value=result) as run:
            observed = process_mac.workspace_provider_worker(
                self.root, "workspace-provider-pull-once",
                provider_config_sha256=hashlib.sha256(pull).hexdigest(),
            )
        self.assertEqual(observed, result)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertEqual(argv[argv.index("--limit") + 1], "1")
        self.assertEqual(argv[argv.index("--topic") + 1], "zenith-intake-v1")
        self.assertEqual(argv[argv.index("--intake-opener-sha256") + 1], "e" * 64)
        self.assertEqual(argv[argv.index("--oidc-token-file") + 1], str(token))
        self.assertNotIn("header.payload.signature", argv)
        self.assertNotIn("--service-database", argv)

    def test_provider_pull_rejects_changed_configuration_before_dispatch(self):
        self.rows.append({
            "role": "provider-intake-opener", "filename": "secs-provider-intake-v1",
            "sha256": "e" * 64,
        })
        private_file(
            self.root / "config/provider-pull.json",
            {"schema": "hub.provider-pull.v1", "region": "sfo1", "topic": "topic",
             "consumer_group": "group", "lease_seconds": 300},
        )
        token = self.root / "config/provider-vercel-oidc-token"
        token.write_text("header.payload.signature\n")
        token.chmod(0o600)
        with mock.patch.object(process_mac, "workspace_run") as run:
            with self.assertRaises(process_mac.InstallError):
                process_mac.workspace_provider_worker(
                    self.root, "workspace-provider-pull-once",
                    provider_config_sha256="d" * 64,
                )
        run.assert_not_called()

    def test_provider_reference_pull_uses_separate_pinned_topic(self):
        self.rows.append({
            "role": "provider-intake-opener", "filename": "secs-provider-intake-v1",
            "sha256": "e" * 64,
        })
        pull = private_file(
            self.root / "config/provider-reference-pull.json",
            {"schema": "hub.provider-pull.v1", "region": "sfo1",
             "topic": "zenith-reference-v1",
             "consumer_group": "zenith-provider-mac-reference",
             "lease_seconds": 300},
        )
        token = self.root / "config/provider-vercel-oidc-token"
        token.write_text("header.payload.signature\n")
        token.chmod(0o600)
        result = {"schema": "service.provider-worker-result.v1",
                  "command": "pull-references-once", "processed": 1,
                  "results": [{"object_id": "ref-1"}]}
        with mock.patch.object(process_mac, "workspace_run", return_value=result) as run:
            observed = process_mac.workspace_provider_worker(
                self.root, "workspace-provider-pull-references-once",
                provider_config_sha256=hashlib.sha256(pull).hexdigest(),
            )
        self.assertEqual(observed, result)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertIn("pull-references-once", argv)
        self.assertEqual(argv[argv.index("--topic") + 1], "zenith-reference-v1")
        self.assertEqual(
            argv[argv.index("--consumer-group") + 1],
            "zenith-provider-mac-reference",
        )
        self.assertNotIn("header.payload.signature", argv)

    def test_provider_activation_preview_uses_only_the_retained_intake(self):
        result = {"schema": "service.provider-worker-result.v1",
                  "command": "activation-brand-package-once", "processed": 1,
                  "results": [{"request_id": "req-1", "stage": "request_admitted",
                               "activation": {"handoff_id": "a" * 64,
                                              "run_id": "handoff-" + "a" * 48}}]}
        with mock.patch.object(process_mac, "workspace_run", return_value=result) as run:
            observed = process_mac.workspace_provider_worker(
                self.root, "workspace-provider-activation-once")
        self.assertEqual(observed, result)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertIn("--intake-database", argv)
        self.assertNotIn("--service-database", argv)
        self.assertNotIn("--runtime-endpoint", argv)

    def test_provider_projection_binds_exact_stores_authority_and_origins(self):
        policy = private_file(
            self.root / "config/provider-requester-policy.json",
            {"schema": "service.castalia-requester-policy.v1", "fixture": True})
        projection = private_file(self.root / "config/provider-projection.json", {
            "schema": "hub.provider-projection.v1",
            "browser_origin": "https://anima.example",
            "public_base_url": "https://matrix-home.example.ts.net/zenith/provider",
            "requester_policy_sha256": hashlib.sha256(policy).hexdigest(),
            "port": 8293,
        })
        for name in ("provider-intake.db", "service.db"):
            target = self.root / "data" / name
            target.touch(mode=0o600)
        runtime_config = self.root / "authority/runtime/config"
        runtime_config.mkdir(mode=0o700, parents=True)
        private_file(runtime_config / "wallet-command.json", {"runtime": True})
        receipt = {
            "scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
            "permission": {"state": "active"},
            "configuration_hashes": {"wallet-command.json": "c" * 64},
        }
        with mock.patch.object(
            process_mac, "workspace_provider_service_status",
            return_value={"state": "configured_native_unqualified",
                          "permission": {"state": "active"}},
        ), mock.patch.object(
            process_mac, "workspace_ready", return_value=receipt,
        ), mock.patch.object(
            process_mac, "workspace_permission", return_value={"state": "active"},
        ), mock.patch.object(
            process_mac, "workspace_config_directory", return_value=runtime_config,
        ), mock.patch.object(
            process_mac, "config",
            return_value={"mode": "workspace", "runtime_port": 8292,
                          "service_port": 8291},
        ):
            argv, pin = process_mac.workspace_provider_projection_argv(
                self.root, hashlib.sha256(projection).hexdigest())
            plist = process_mac.job(self.root, process_mac.PROVIDER_PROJECTION)
        values = [str(value) for value in argv]
        self.assertEqual(pin, hashlib.sha256(projection).hexdigest())
        self.assertEqual(values[values.index("--public-base-url") + 1],
                         "https://matrix-home.example.ts.net/zenith/provider")
        self.assertEqual(values[values.index("--runtime-endpoint") + 1],
                         "http://127.0.0.1:8292")
        self.assertEqual(values[values.index("--port") + 1], "8293")
        self.assertNotIn("tailscale", " ".join(values).lower())
        self.assertIn("_run-provider-projection", plist["ProgramArguments"])
        self.assertIn(pin, plist["ProgramArguments"])

    def test_provider_projection_rejects_unreviewed_or_insecure_origin(self):
        policy = private_file(
            self.root / "config/provider-requester-policy.json", {"fixture": True})
        projection = private_file(self.root / "config/provider-projection.json", {
            "schema": "hub.provider-projection.v1",
            "browser_origin": "https://anima.example",
            "public_base_url": "http://matrix-home.example.ts.net",
            "requester_policy_sha256": hashlib.sha256(policy).hexdigest(),
            "port": 8293,
        })
        with self.assertRaises(process_mac.InstallError):
            process_mac.workspace_provider_projection_config(
                self.root, hashlib.sha256(projection).hexdigest())

    def test_provider_projection_allows_only_numeric_loopback_http_for_local_browser(self):
        policy = private_file(
            self.root / "config/provider-requester-policy.json", {"fixture": True})
        projection_path = self.root / "config/provider-projection.json"
        base = {
            "schema": "hub.provider-projection.v1",
            "public_base_url": "https://matrix-home.example.ts.net/zenith/provider",
            "requester_policy_sha256": hashlib.sha256(policy).hexdigest(),
            "port": 8293,
        }
        for origin in ("http://127.0.0.1:4337", "http://[::1]:4337"):
            projection = private_file(projection_path, {**base, "browser_origin": origin})
            _, value, _ = process_mac.workspace_provider_projection_config(
                self.root, hashlib.sha256(projection).hexdigest())
            self.assertEqual(value["browser_origin"], origin)
        for origin in ("http://localhost:4337", "http://anima.example",
                       "http://127.0.0.1:4337/path"):
            projection = private_file(projection_path, {**base, "browser_origin": origin})
            with self.subTest(origin=origin), self.assertRaises(process_mac.InstallError):
                process_mac.workspace_provider_projection_config(
                    self.root, hashlib.sha256(projection).hexdigest())

    def test_provider_admission_open_is_reviewed_applied_and_idempotent(self):
        receipt = {"scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
                   "plan_sha256": "f" * 64,
                   "not_before": int(time.time()) - 5,
                   "not_after": int(time.time()) + 3500,
                   "identity_not_after": int(time.time()) + 86400}
        private_file(self.root / "config/workspace-admission.json",
                     {"schema": "runtime.new-run-admission.v1", "enabled": False,
                      "composition_digest": "0" * 64})
        with mock.patch.object(process_mac, "workspace_ready", return_value=receipt):
            proposal = process_mac.workspace_prepare_provider_admission(self.root, True)

            def apply(argv, root):
                plan = json.loads((self.root / process_mac.WORKSPACE_PROVIDER_ADMISSION_PLAN).read_text())
                raw = private_file(self.root / "config/workspace-admission.json", plan["policy"])
                canonical = json.dumps(plan["policy"], sort_keys=True, separators=(",", ":")).encode()
                return {"schema": "runtime.new-run-admission-result.v1",
                        "data": {"policy_digest": hashlib.sha256(canonical).hexdigest(),
                                 "enabled": True, "composition_digest": "f" * 64}}

            with mock.patch.object(process_mac, "workspace_run", side_effect=apply) as run:
                completed = process_mac.workspace_apply_provider_admission(
                    self.root, proposal["plan_sha256"])
                duplicate = process_mac.workspace_apply_provider_admission(
                    self.root, proposal["plan_sha256"])
        self.assertTrue(completed["enabled"])
        self.assertFalse(completed["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(run.call_count, 1)

    def test_delivery_requires_open_admission_and_exact_receipt_handoff(self):
        handoff_id = "a" * 64
        runtime_receipt = {"scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
                           "plan_sha256": "f" * 64,
                           "handoff_id": handoff_id,
                           "run_id": "handoff-" + handoff_id[:48],
                           "not_before": int(time.time()) - 5,
                           "not_after": int(time.time()) + 3500,
                           "identity_not_after": int(time.time()) + 86400,
                           "configuration_hashes": {"wallet-command.json": "d" * 64}}
        runtime_dir = self.root / "authority/renewals/2/config"
        result = {"schema": "service.provider-worker-result.v1",
                  "command": "deliver-handoff-once", "processed": 1,
                  "results": [{"state": "started"}]}
        admission = {"schema": "runtime.new-run-admission.v1", "enabled": True,
                     "composition_digest": "f" * 64}
        with mock.patch.object(process_mac, "workspace_ready", return_value=runtime_receipt), \
                mock.patch.object(process_mac, "workspace_admission",
                                  return_value=(admission, "e" * 64)), \
                mock.patch.object(process_mac, "workspace_config_directory",
                                  return_value=runtime_dir), \
                mock.patch.object(process_mac, "owns_listener", return_value=True), \
                mock.patch.object(process_mac, "config", return_value={"runtime_port": 8092}), \
                mock.patch.object(process_mac, "workspace_run", return_value=result) as run:
            observed = process_mac.workspace_provider_worker(
                self.root, "workspace-provider-deliver-handoff-once")
        self.assertEqual(observed, result)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertNotIn("--intake-database", argv)
        self.assertEqual(argv[argv.index("--handoff-id") + 1], handoff_id)

    def test_delivery_rejects_closed_runtime_admission_before_dispatch(self):
        runtime_receipt = {"scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
                           "plan_sha256": "f" * 64, "handoff_id": "a" * 64,
                           "not_before": int(time.time()) - 5,
                           "not_after": int(time.time()) + 3500,
                           "identity_not_after": int(time.time()) + 86400}
        closed = {"schema": "runtime.new-run-admission.v1", "enabled": False,
                  "composition_digest": "f" * 64}
        with mock.patch.object(process_mac, "workspace_ready", return_value=runtime_receipt), \
                mock.patch.object(process_mac, "workspace_admission",
                                  return_value=(closed, "e" * 64)), \
                mock.patch.object(process_mac, "workspace_run") as run:
            with self.assertRaises(process_mac.InstallError):
                process_mac.workspace_provider_worker(
                    self.root, "workspace-provider-deliver-handoff-once")
        run.assert_not_called()

    def test_provider_admission_rejects_changed_policy_before_dispatch(self):
        private_file(
            self.root / "config/provider-requester-policy.json",
            {"schema": "service.castalia-requester-policy.v1", "allowed": []},
        )
        with mock.patch.object(
            process_mac,
            "workspace_provider_service_status",
            return_value={"state": "configured_native_unqualified", "permission": {"state": "active"}},
        ), mock.patch.object(
            process_mac,
            "workspace_provider_service_receipt",
            return_value={"configuration_hashes": {"wallet-command.json": "c" * 64}},
        ), mock.patch.object(process_mac, "workspace_run") as run:
            with self.assertRaises(process_mac.InstallError):
                process_mac.workspace_provider_worker(
                    self.root, "workspace-provider-admit-once", "d" * 64
                )
        run.assert_not_called()

    def test_provider_lifecycle_dispatch_requires_exact_runtime_authority(self):
        service_receipt = {
            "configuration_hashes": {"wallet-command.json": "c" * 64}
        }
        runtime_receipt = {
            "scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
            "actor_id": "frank-anima",
            "handoff_id": "a" * 64,
            "run_id": "handoff-" + "a" * 48,
            "not_before": int(time.time()) - 5,
            "not_after": int(time.time()) + 3500,
            "identity_not_after": int(time.time()) + 86400,
            "configuration_hashes": {"wallet-command.json": "d" * 64},
        }
        runtime_dir = self.root / "authority/renewals/2/config"
        result = {
            "schema": "service.provider-worker-result.v1",
            "command": "advance-brand-package-once",
            "processed": 1,
            "results": [{"case_id": "case-1"}],
        }
        with mock.patch.object(
            process_mac,
            "workspace_provider_service_status",
            return_value={"state": "configured_native_unqualified", "permission": {"state": "active"}},
        ), mock.patch.object(
            process_mac, "workspace_provider_service_receipt", return_value=service_receipt
        ), mock.patch.object(
            process_mac, "workspace_ready", return_value=runtime_receipt
        ), mock.patch.object(
            process_mac, "workspace_config_directory", return_value=runtime_dir
        ), mock.patch.object(
            process_mac, "owns_listener", return_value=True
        ), mock.patch.object(process_mac, "config", return_value={"runtime_port": 8092}), mock.patch.object(
            process_mac, "workspace_run", return_value=result
        ) as run:
            observed = process_mac.workspace_provider_worker(
                self.root, "workspace-provider-advance-once"
            )
        self.assertEqual(observed, result)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertNotIn("--requester-policy", argv)
        self.assertEqual(argv[argv.index("--process-id") + 1], process_mac.PROVIDER_PROCESS_ID)
        self.assertEqual(argv[argv.index("--process-version") + 1], process_mac.PROVIDER_PROCESS_VERSION)
        self.assertEqual(argv[argv.index("--compilation-hash") + 1], process_mac.PROVIDER_PROCESS_COMPILATION)

    def test_reviewed_frank_operation_runs_one_exact_brand_step(self):
        run_id = "handoff-" + "a" * 48
        config = private_file(self.root / "config/frank-live-provider.json", {"selected": True})
        plan = private_file(self.root / "config/provider-frank-operation.json", {
            "schema": "hub.provider-frank-operation.v1", "action": "execute",
            "config_sha256": hashlib.sha256(config).hexdigest(), "run_id": run_id,
            "step_id": "qualify-intake", "request_id": "claim-qualify-1", "effect_key": None,
        })
        receipt = {"scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
                   "actor_id": process_mac.PROVIDER_FRANK_ACTOR, "run_id": run_id,
                   "not_before": int(time.time()) - 5, "not_after": int(time.time()) + 3500,
                   "identity_not_after": int(time.time()) + 86400}
        with mock.patch.object(process_mac, "workspace_ready", return_value=receipt), \
                mock.patch.object(process_mac, "workspace_permission", return_value={"state": "active"}), \
                mock.patch.object(process_mac, "owns_listener", return_value=True), \
                mock.patch.object(process_mac, "workspace_run", return_value={"effect_key": "effect-1"}) as run:
            result = process_mac.workspace_provider_actor_operation(
                self.root, "workspace-provider-frank-operation", hashlib.sha256(plan).hexdigest())
        self.assertEqual(result["actor_id"], process_mac.PROVIDER_FRANK_ACTOR)
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertEqual(argv[argv.index("--scope") + 1], "zenith.anima.brand-package")
        self.assertEqual(argv[argv.index("--step-id") + 1], "qualify-intake")
        self.assertEqual(argv[argv.index("--run-id") + 1], run_id)

    def test_reviewed_human_decision_uses_exact_pinned_file(self):
        run_id = "handoff-" + "a" * 48
        config = private_file(self.root / "config/brand-approval.json", {"selected": True})
        decision = private_file(self.root / "config/brand-approval-decision.json", {"approved": True})
        plan = private_file(self.root / "config/provider-review-operation.json", {
            "schema": "hub.provider-review-operation.v1", "action": "decide",
            "config_sha256": hashlib.sha256(config).hexdigest(), "run_id": run_id,
            "request_id": None, "decision_sha256": hashlib.sha256(decision).hexdigest(),
        })
        receipt = {"scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
                   "actor_id": process_mac.PROVIDER_REVIEW_ACTOR, "run_id": run_id,
                   "not_before": int(time.time()) - 5, "not_after": int(time.time()) + 3500,
                   "identity_not_after": int(time.time()) + 86400}
        with mock.patch.object(process_mac, "workspace_ready", return_value=receipt), \
                mock.patch.object(process_mac, "workspace_permission", return_value={"state": "active"}), \
                mock.patch.object(process_mac, "owns_listener", return_value=True), \
                mock.patch.object(process_mac, "workspace_run", return_value={"approved": True}) as run:
            process_mac.workspace_provider_actor_operation(
                self.root, "workspace-provider-review-operation", hashlib.sha256(plan).hexdigest())
        argv = [str(value) for value in run.call_args.args[0]]
        self.assertEqual(argv[argv.index("--decision-sha256") + 1], hashlib.sha256(decision).hexdigest())
        self.assertEqual(argv[argv.index("--decision") + 1],
                         str(self.root / "config/brand-approval-decision.json"))

    def test_provider_actor_operation_denies_authority_for_other_actor(self):
        run_id = "handoff-" + "a" * 48
        config = private_file(self.root / "config/frank-live-provider.json", {"selected": True})
        plan = private_file(self.root / "config/provider-frank-operation.json", {
            "schema": "hub.provider-frank-operation.v1", "action": "work",
            "config_sha256": hashlib.sha256(config).hexdigest(), "run_id": run_id,
            "step_id": None, "request_id": None, "effect_key": None,
        })
        receipt = {"scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
                   "actor_id": process_mac.PROVIDER_REVIEW_ACTOR, "run_id": run_id}
        with mock.patch.object(process_mac, "workspace_ready", return_value=receipt), \
                mock.patch.object(process_mac, "workspace_run") as run:
            with self.assertRaises(process_mac.InstallError):
                process_mac.workspace_provider_actor_operation(
                    self.root, "workspace-provider-frank-operation", hashlib.sha256(plan).hexdigest())
        run.assert_not_called()


class ProviderReleaseProfileTests(unittest.TestCase):
    def profile(self, native_profile, roles, marker):
        names = ["frank-executor", "process-runtime", "service-management",
                 *(f"dependency-{index}" for index in range(12))]
        if native_profile == "workspace-provider-v1":
            names.extend(sorted(process_mac.PROVIDER_QUEUE_PACKAGES))
        wheels = [
            {"name": name, "filename": f"{name.replace('-', '_')}-0.1.0-py3-none-any.whl",
             "version": "0.1.0", "bytes": 1, "sha256": marker * 64}
            for name in names
        ]
        components = {
            "frank": {"package": "frank-executor", "version": "0.1.0",
                      "source_commit": marker * 40, "wheel_sha256": marker * 64},
            "process-runtime": {"package": "process-runtime", "version": "0.1.0",
                                "source_commit": marker * 40, "wheel_sha256": marker * 64},
            "service-management": {"package": "service-management", "version": "0.1.0",
                                   "source_commit": marker * 40, "wheel_sha256": marker * 64},
        }
        native = [
            {"role": role, "filename": filename, "bytes": 1, "sha256": marker * 64,
             "source_commit": marker * 40, "mode": 0o500}
            for role, filename in roles.items()
        ]
        return {"schema": "hub.process-macos-release.v2", "platform": "darwin",
                "machine": "arm64", "python": [3, 12], "components": components,
                "wheels": wheels, "native_profile": native_profile, "native": native}

    def test_provider_profile_requires_connector_and_intake_native_closure(self):
        profile = self.profile("workspace-provider-v1", process_mac.WORKSPACE_PROVIDER_ROLES, "a")
        self.assertEqual(
            {row["role"] for row in process_mac.native_rows(profile)},
            set(process_mac.WORKSPACE_PROVIDER_ROLES),
        )
        profile["native"] = profile["native"][:-1]
        with self.assertRaises(process_mac.InstallError):
            process_mac.native_rows(profile)

    def test_explicit_provider_upgrade_accepts_changed_pinned_stack_and_rejects_downgrade(self):
        old = self.profile("workspace-live-provider-v1", process_mac.WORKSPACE_LIVE_ROLES, "a")
        new = self.profile("workspace-provider-v1", process_mac.WORKSPACE_PROVIDER_ROLES, "b")
        process_mac.workspace_upgrade_policy(old, new)
        incomplete = json.loads(json.dumps(new))
        incomplete["wheels"] = [row for row in incomplete["wheels"] if row["name"] != "vercel-queue"]
        with self.assertRaises(process_mac.InstallError):
            process_mac.workspace_upgrade_policy(old, incomplete)
        with self.assertRaises(process_mac.InstallError):
            process_mac.workspace_upgrade_policy(new, old)


if __name__ == "__main__":
    unittest.main()
