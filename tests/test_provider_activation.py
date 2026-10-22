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


if __name__ == "__main__":
    unittest.main()
