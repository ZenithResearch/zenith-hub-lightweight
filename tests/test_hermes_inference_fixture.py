"""Opt-in actual Hermes agent check using only a local fixture model server.
Run in Hermes Python with HUB_TEST_HERMES_SOURCE pointing to its pinned source.
No user profile, credentials, real model or external inference server is used.
"""
import os
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = 'import tempfile,os,sys,json,threading,http.server,pathlib\nsource=sys.argv[1]\nwith tempfile.TemporaryDirectory(prefix="hub-hermes-fixture-") as temp:\n os.environ.update(HOME=temp,HERMES_HOME=temp,PYTHONDONTWRITEBYTECODE="1",HERMES_NON_INTERACTIVE="1")\n sys.path.insert(0,source)\n seen=[]\n class Handler(http.server.BaseHTTPRequestHandler):\n  def log_message(self,*a):pass\n  def do_POST(self):\n   body=json.loads(self.rfile.read(int(self.headers["Content-Length"])));seen.append(body)\n   response={"id":"fixture","object":"chat.completion","created":1,"model":"Inkling-2-Mini","choices":[{"index":0,"message":{"role":"assistant","content":"INKLING_FIXTURE_OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n   data=json.dumps(response).encode();self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)\n server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)\n threading.Thread(target=server.serve_forever,daemon=True).start()\n pathlib.Path(temp,"config.yaml").write_text(json.dumps({"model":{"streaming":False,"context_length":65536},"platform_toolsets":{"api_server":[]},"agent":{"max_iterations":1}}))\n try:\n  from run_agent import AIAgent\n  agent=AIAgent(provider="custom",base_url=f"http://127.0.0.1:{server.server_port}/v1",api_key="fixture-only",\n   model="Inkling-2-Mini",max_iterations=1,max_tokens=64,enabled_toolsets=[],skip_context_files=True,\n   skip_memory=True,skip_background_review=True,quiet_mode=True,platform="api_server")\n  result=agent.run_conversation(user_message="Reply with INKLING_FIXTURE_OK.",conversation_history=[])\n  assert result.get("final_response")=="INKLING_FIXTURE_OK", "Native agent did not return fixture reply"\n  assert len(seen)==1 and not seen[0].get("tools") and not seen[0].get("stream"), "Hub inference contract changed"\n  agent.close()\n finally:server.shutdown();server.server_close()\n'

@unittest.skipUnless(os.environ.get("HUB_TEST_HERMES_SOURCE"), "Set HUB_TEST_HERMES_SOURCE and run with installed Hermes Python")
class HermesInferenceFixture(unittest.TestCase):
    def test_native_agent_obeys_hub_no_tools_non_streaming_contract(self):
        source = Path(os.environ["HUB_TEST_HERMES_SOURCE"]).resolve(strict=True)
        self.assertTrue((source / "run_agent.py").is_file())
        # Deliberately exclude all provider credentials and saved user homes.
        env = {"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1", "LANG": "C.UTF-8"}
        result = subprocess.run([sys.executable, "-B", "-c", SCRIPT, str(source)],
                                cwd=source, env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-4000:])

if __name__ == "__main__": unittest.main()
