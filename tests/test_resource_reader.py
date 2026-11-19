"""The organization-side reader follows the same registered resource binding."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).parents[1] / "profiles/devgraph-docker/devgraph_connection.py"
SPEC = importlib.util.spec_from_file_location("resource_reader", SOURCE)
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


class ResourceReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.credential = self.root / "read"
        self.token = "dgread1_" + "a" * 43
        self.credential.write_text(self.token)
        self.credential.chmod(0o600)
        self.config = self.root / "resources.json"
        self.value = {"schema": "zenith.hub-resources.v1", "revision": 1, "resources": [{
            "id": "example-devgraph", "kind": "devgraph", "label": "Existing graph",
            "endpoint": "http://127.0.0.1:4220", "credentialFile": str(self.credential),
            "lifecycle": "external", "enabled": True,
        }]}
        self.save()
        self.calls = []
        outer = self
        class Opener:
            def open(self, request, timeout):
                outer.calls.append((request.full_url, request.get_header("Authorization")))
                value = {"ready": True} if request.full_url.endswith("/ready") else {"items": []}
                return io.BytesIO(json.dumps(value).encode())
        self.connection = reader.RegisteredConnection(self.config, "example-devgraph", opener=Opener())

    def save(self):
        self.config.write_text(json.dumps(self.value))
        self.config.chmod(0o600)

    def test_existing_resource_connects_without_exposing_credential_reference(self):
        result = self.connection.status()
        self.assertTrue(result["connected"])
        self.assertEqual(result["resourceId"], "example-devgraph")
        self.assertEqual(result["lifecycle"], "external")
        self.assertNotIn(self.token, json.dumps(result))
        self.assertNotIn(str(self.credential), json.dumps(result))

    def test_binding_disable_and_reenable_apply_without_restarting_the_reader(self):
        self.assertTrue(self.connection.status()["connected"])
        count = len(self.calls)
        self.value["resources"][0]["enabled"] = False
        self.save()
        self.assertEqual(self.connection.status()["state"], "disconnected")
        self.assertEqual(len(self.calls), count)
        self.value["resources"][0]["enabled"] = True
        self.save()
        self.assertTrue(self.connection.status()["connected"])

    def test_missing_and_unsafe_bindings_are_not_empty_graphs(self):
        self.value["resources"] = []
        self.save()
        self.assertEqual(self.connection.status()["state"], "resource_not_registered")
        self.config.chmod(0o644)
        self.assertEqual(self.connection.status()["state"], "resource_configuration_unavailable")
        self.assertEqual(self.calls, [])

    def test_foreign_endpoint_and_unknown_configuration_fields_are_rejected(self):
        self.value["resources"][0]["endpoint"] = "https://example.invalid:4220"
        self.save()
        self.assertEqual(self.connection.status()["state"], "resource_configuration_unavailable")
        self.value["resources"][0]["endpoint"] = 4220
        self.save()
        self.assertEqual(self.connection.status()["state"], "resource_configuration_unavailable")
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
