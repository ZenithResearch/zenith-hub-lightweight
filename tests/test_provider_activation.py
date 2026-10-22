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
