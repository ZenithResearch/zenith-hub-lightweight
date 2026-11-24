"""Private bridge boundary checks; optional FastAPI dependency is in managed Hermes.

Run with the installed Hermes environment to exercise actual HTTP/model schemas.
Native provider/network calls are mocked; no account, file or model is changed.
"""
import copy
import importlib.util
import pathlib
import json
import tempfile
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

spec = importlib.util.spec_from_file_location('hub_hermes_models', 'scripts/setup/hermes-models.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class DefaultConfigurationTests(unittest.TestCase):
    def test_api_setup_preserves_default_model_other_platforms_and_cli_tools(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root / "data").mkdir()
            (root / "data/hub-secrets.json").write_text(json.dumps({"API_SERVER_KEY": "fixture-private-key"}))
            prior = {"model": {"provider": "existing", "default": "kept", "api_key": "kept-provider-key"}, "mcp_servers": {"retained": {}}, "agent": {"max_iterations": 27}, "platforms": {"matrix": {"enabled": True}}, "platform_toolsets": {"cli": ["retained"]}}
            saved = []
            config = types.SimpleNamespace(load_config=lambda: copy.deepcopy(prior), save_config=saved.append)
            result = bridge.configure_api(config, root, 19442)
            updated = saved[0]
            for key in ["model", "mcp_servers", "agent"]:
                self.assertEqual(updated[key], prior[key])
            self.assertEqual(updated["platforms"]["matrix"], prior["platforms"]["matrix"])
            self.assertEqual(updated["platform_toolsets"]["cli"], ["retained"])
            self.assertEqual(updated["platform_toolsets"]["api_server"], [])
            self.assertEqual(updated["platforms"]["api_server"]["extra"], {"host": "127.0.0.1", "port": 19442, "key": "fixture-private-key"})
            self.assertNotIn("fixture-private-key", json.dumps(result))
            self.assertEqual(config.load_config(), prior)
            for port in [True, 1023, 65536, "19442"]:
                with self.assertRaises(ValueError): bridge.configure_api(config, root, port)
            self.assertEqual(len(saved), 1)
            occupied = copy.deepcopy(prior)
            occupied["platforms"]["api_server"] = {"enabled": True, "extra": {"port": 8642, "key": "other-owner-key"}}
            config.load_config = lambda: copy.deepcopy(occupied)
            with self.assertRaises(bridge.DefaultAPIConflict): bridge.configure_api(config, root, 19442)
            self.assertEqual(len(saved), 1)
            self.assertEqual(config.load_config(), occupied)


@unittest.skipUnless(importlib.util.find_spec('fastapi') and importlib.util.find_spec('httpx'), 'Run with the managed Hermes Python for FastAPI bridge checks')
class ModelManagerTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        self.config = {'model': {'provider': 'custom', 'default': 'old', 'base_url': 'http://127.0.0.1:19343/v1', 'key_env': 'HUB_MODEL_API_KEY', 'api_key': 'fixture-legacy-only'}, 'mcp_servers': {'retained': {}}}
        self.hconfig = types.SimpleNamespace(load_config=lambda: copy.deepcopy(self.config), save_config=self.save)
        self.env = types.SimpleNamespace(validate_provider_credential=AsyncMock(return_value={'reachable': True, 'ok': True}), set_env_var=AsyncMock(return_value={'ok': True}))
        self.models = types.SimpleNamespace(set_model_assignment=AsyncMock(side_effect=self.assign), get_model_options=AsyncMock(return_value={"providers":[{"slug":"gemini","models":["expensive-first","native-default","saved-model"]}]}), get_recommended_default_model=Mock(return_value={"provider":"gemini","model":"native-default"}))
        self.oauth = types.SimpleNamespace(_build_oauth_catalog=lambda: [], start_oauth_login=AsyncMock(), poll_oauth_session=AsyncMock(return_value={'session_id': 'fixture-session', 'status': 'approved', 'access_token': 'fixture-private-token'}))
        descriptors = lambda: [types.SimpleNamespace(slug='gemini', label='Google AI Studio', description='Native Gemini', api_key_env_vars=['GOOGLE_API_KEY'], signup_url='https://aistudio.google.com/app/apikey')]
        native = (None, self.hconfig, descriptors, self.env, self.models, self.oauth, None, None, None, None)
        class Body:
            def __init__(self, **kw): self.__dict__.update(kw)
        package = types.ModuleType('hermes_cli'); package.__path__ = []
        schemas = types.ModuleType('hermes_cli.web_models'); schemas.EnvVarUpdate = Body; schemas.ModelAssignment = Body
        modules = patch.dict(sys.modules, {'hermes_cli': package, 'hermes_cli.web_models': schemas})
        modules.start(); self.addCleanup(modules.stop)
        with patch.object(bridge, 'load_native', return_value=native):
            self.client = TestClient(bridge.create_app(pathlib.Path('/fixture-only'), {'models': []}, 'fixture-manager-token', 'fixture-identity'))
        self.addCleanup(self.client.close)

    def save(self, config): self.config = copy.deepcopy(config)
    async def assign(self, body):
        self.config['model'].update(provider=body.provider, default=body.model, base_url=body.base_url)
        return {'ok': True}
    def post(self, body, auth=True):
        return self.client.post('/request', json=body, headers={'Authorization': 'Bearer fixture-manager-token'} if auth else {})

    def test_private_auth_and_credentials_never_enter_responses(self):
        payload = {'action': 'connect-key', 'providerId': 'gemini', 'apiKey': 'fixture-key-only'}
        self.assertEqual(self.post(payload, auth=False).status_code, 401)
        self.env.set_env_var.assert_not_called()
        response = self.post(payload)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(payload['apiKey'], response.text)
        self.assertEqual(self.env.validate_provider_credential.call_args.args[0].key, 'GEMINI_API_KEY')
        self.assertEqual(self.env.set_env_var.call_args.args[0].key, 'GOOGLE_API_KEY')
        self.env.validate_provider_credential.return_value = {'reachable': True, 'ok': False}
        self.env.set_env_var.reset_mock()
        self.assertEqual(self.post(payload).status_code, 409)
        self.env.set_env_var.assert_not_called()

    def test_signin_poll_returns_status_without_tokens(self):
        response = self.post({'action': 'oauth-poll', 'providerId': 'gemini', 'sessionId': 'fixture-session'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'approved')
        self.assertNotIn('fixture-private-token', response.text)
        self.assertNotIn('access_token', response.json())

    def test_model_catalog_returns_native_recommendation_without_activating_it(self):
        before = copy.deepcopy(self.config)
        response = self.post({'action': 'models', 'providerId': 'gemini'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['recommendedModel'], 'native-default')
        self.assertEqual(response.json()['currentModel'], '')
        self.assertEqual(self.config, before)
        self.models.set_model_assignment.assert_not_called()

    def test_saved_model_is_scoped_to_its_provider_and_missing_recommendations_are_not_invented(self):
        self.config['model'].update(provider='gemini', default='saved-model')
        self.models.get_recommended_default_model.return_value = {'provider':'gemini','model':'not-in-catalog'}
        response = self.post({'action': 'models', 'providerId': 'gemini'})
        self.assertEqual(response.json()['currentModel'], 'saved-model')
        self.assertEqual(response.json()['recommendedModel'], '')
        self.models.set_model_assignment.assert_not_called()

    def test_native_assignment_retains_unrelated_settings_and_discards_old_endpoint_credentials(self):
        response = self.post({'action': 'apply-backend', 'providerId': 'gemini', 'modelName': 'fixture-model', 'baseUrl': '', 'apiPort': 19442})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.config['model']['provider'], 'gemini')
        self.assertNotIn('key_env', self.config['model'])
        self.assertNotIn('api_key', self.config['model'])
        self.assertEqual(self.config['mcp_servers'], {'retained': {}})
        self.assertEqual(self.config['platforms']['api_server']['extra']['port'], 19442)
        self.assertNotIn('fixture-legacy-only', response.text)
        assignment = self.models.set_model_assignment.call_args.args[0]
        self.assertEqual(assignment.scope, 'main')
        self.assertTrue(assignment.confirm_expensive_model)

    def test_cached_native_assignment_cannot_restore_an_old_custom_endpoint(self):
        self.models.set_model_assignment = AsyncMock(return_value={'ok': True})
        response = self.post({'action': 'apply-backend', 'providerId': 'custom', 'modelName': 'new-model', 'baseUrl': 'http://127.0.0.1:19443/v1', 'contextLength': 65536})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.config['model']['base_url'], 'http://127.0.0.1:19443/v1')
        self.assertEqual(self.config['model']['default'], 'new-model')
        self.assertEqual(self.config['model']['context_length'], 65536)
        self.assertNotIn('key_env', self.config['model'])
        self.assertNotIn('api_key', self.config['model'])

    def test_cloud_assignment_removes_cached_custom_endpoint(self):
        self.models.set_model_assignment = AsyncMock(return_value={'ok': True})
        response = self.post({'action': 'apply-backend', 'providerId': 'gemini', 'modelName': 'native-default', 'baseUrl': ''})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.config['model']['provider'], 'gemini')
        self.assertNotIn('base_url', self.config['model'])
        self.assertEqual(self.config['mcp_servers'], {'retained': {}})

class SplitModelIntegrityTests(unittest.TestCase):
    def test_subdirectory_shards_are_verified_at_native_flattened_destinations(self):
        import tempfile, hashlib
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); models = root/'models'; assets = models/'assets'
            assets.mkdir(parents=True)
            def shard(remote, content, directory, local=None):
                (directory/(local or pathlib.Path(remote).name)).write_bytes(content)
                return {'path': remote, 'size_bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), **({'local': local} if local else {})}
            first = shard('Q4_K_M/large-00001-of-00002.gguf', b'header', models)
            last = shard('Q4_K_M/large-00002-of-00002.gguf', b'weights', models)
            companion = shard('mmproj.gguf', b'vision', assets, 'unique-mmproj.gguf')
            raw = {'variants':[{'files':[first,last]}], 'mmproj':companion}
            bridge.verify_model_artifacts(raw, models, assets)
            (models/'large-00002-of-00002.gguf').write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'reviewed hash'):
                bridge.verify_model_artifacts(raw, models, assets)

    def test_missing_or_symlinked_shard_cannot_count_as_verified(self):
        import tempfile, hashlib
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); models = root/'models'; models.mkdir()
            content = b'weights'; target = root/'elsewhere'; target.write_bytes(content)
            pin = {'path':'sub/model.gguf', 'size_bytes':len(content), 'sha256':hashlib.sha256(content).hexdigest()}
            raw = {'variants':[{'files':[pin]}]}
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                bridge.verify_model_artifacts(raw, models, root/'assets')
            (models/'model.gguf').symlink_to(target)
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                bridge.verify_model_artifacts(raw, models, root/'assets')
