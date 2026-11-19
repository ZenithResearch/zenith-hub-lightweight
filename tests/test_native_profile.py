"""Keep native and container demo releases on the same normalized components."""
import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parents[1]


class NativeProfileTests(unittest.TestCase):
    def test_installation_profile_uses_normalized_components_without_native_activation(self):
        profile=json.loads((ROOT/'profiles/process-macos/release.v1.json').read_text())
        native=json.loads((ROOT/'profiles/process-native/profile.json').read_text())
        self.assertEqual(profile['installation_profile'],'normalized-zenith-v1')
        self.assertEqual(len(profile['wheels']),29)
        self.assertNotIn('native',profile)
        for name,row in native['components'].items():
            self.assertEqual(profile['components'][row['package']]['source_commit'],row['commit'])

    def test_component_pins_match_the_container_profile(self):
        profile = json.loads((ROOT / "profiles/process-native/profile.json").read_text())
        tree = ast.parse((ROOT / "profiles/process-docker/prepare.py").read_text())
        pins = next(ast.literal_eval(node.value) for node in tree.body
                    if isinstance(node, ast.Assign) and any(
                        isinstance(target, ast.Name) and target.id == "PINS" for target in node.targets))
        self.assertEqual(set(profile["components"]), set(pins))
        for name, (repository, commit) in pins.items():
            component = profile["components"][name]
            self.assertEqual((component["repository"], component["commit"]), (repository, commit))
            self.assertEqual(component["package"], repository.split("/")[1])
        self.assertEqual(profile["zenithVersion"], "0.1.0")
        self.assertEqual(profile["pythonVersion"], "3.12")
        self.assertEqual(profile["nodeMajor"], 24)
        self.assertEqual(profile["authority"], "local-dev-untrusted")


if __name__ == "__main__":
    unittest.main()
