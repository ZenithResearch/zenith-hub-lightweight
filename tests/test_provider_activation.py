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
            {"role": "wallet-command", "sha256": "a" * 64},
            {"role": "context-verifier", "sha256": "b" * 64},
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
        proposal = process_mac.workspace_prepare_renewal(
            self.root, actor_id="frank-anima", run_id="anima-brand-request-001"
        )
        raw, plan = process_mac.workspace_renewal_plan(self.root, proposal["plan_sha256"])
        self.assertEqual(plan["schema"], "castalia.wallet-workspace-live-provider-authority.v1")
        self.assertEqual(plan["actor_id"], "frank-anima")
        self.assertEqual(plan["run_id"], "anima-brand-request-001")
        self.assertEqual(proposal["permission_count"], 22)
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
        new = {**old, "holder": {**holder, "state_revision": 2},
               "scope": process_mac.WORKSPACE_PROVIDER_SCOPE,
               "actor_id": "frank-anima", "run_id": "run-1"}
        plan = {"schema": "castalia.wallet-workspace-live-provider-authority.v1",
                "actor_id": "frank-anima", "run_id": "run-1"}
        process_mac.workspace_renewal_identity(old, new, plan)
        with self.assertRaises(process_mac.InstallError):
            process_mac.workspace_renewal_identity(old, {**new, "run_id": "run-2"}, plan)


if __name__ == "__main__":
    unittest.main()
