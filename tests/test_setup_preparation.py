"""Preparation failure/retry and untrusted archive regression checks (no network/build)."""
import hashlib, importlib.util, io, pathlib, tarfile, tempfile, unittest
from unittest.mock import patch

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
matrix=module('matrix_prepare','scripts/setup/matrix-prepare.py')
hermes=module('hermes_install','scripts/setup/hermes-install.py')
class PreparationTests(unittest.TestCase):
 def test_bad_download_retained_then_verified_retry_and_cache_reuse(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d); data=b'verified-public-wheel';row={'filename':'example.whl','url':'https://files.pythonhosted.org/packages/example.whl','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
   with patch.object(matrix.urllib.request,'urlopen',return_value=io.BytesIO(b'bad')):
    with self.assertRaises(AssertionError):matrix.fetch(root,row)
   self.assertTrue((root/'example.whl.partial').exists());self.assertFalse((root/'example.whl').exists())
   with patch.object(matrix.urllib.request,'urlopen',return_value=io.BytesIO(data)):target=matrix.fetch(root,row)
   self.assertTrue(matrix.valid(target,row))
   with patch.object(matrix.urllib.request,'urlopen',side_effect=AssertionError('no new fetch')):self.assertEqual(matrix.fetch(root,row),target)
 def test_download_does_not_follow_a_local_symlink(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);target=root/'private';target.write_bytes(b'untouched');(root/'example.whl.partial').symlink_to(target)
   row={'filename':'example.whl','url':'https://files.pythonhosted.org/packages/example.whl','bytes':3,'sha256':'0'*64}
   with self.assertRaises(AssertionError):matrix.fetch(root,row)
   self.assertEqual(target.read_bytes(),b'untouched')
 def test_hermes_archive_escape_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);archive=root/'source.tar';item=tarfile.TarInfo('../escape');item.size=3
   with tarfile.open(archive,'w') as t:t.addfile(item,io.BytesIO(b'bad'))
   with self.assertRaises(AssertionError):hermes.extract(archive,root/'destination')
   self.assertFalse((root/'escape').exists())
 def test_hermes_bad_hash_keeps_partial_not_completed_runtime(self):
  with tempfile.TemporaryDirectory() as d:
   target=pathlib.Path(d)/'runtime.tar.gz'
   with patch.object(hermes.urllib.request,'urlopen',return_value=io.BytesIO(b'incomplete')):
    with self.assertRaisesRegex(RuntimeError,'artifact_hash_mismatch'):hermes.fetch('https://example.invalid/runtime',target,'0'*64)
   self.assertFalse(target.exists());self.assertTrue(target.with_suffix('.gz.partial').exists())
if __name__=='__main__':unittest.main()

class NativeLifecycleTests(unittest.TestCase):
 def test_stop_delivers_graceful_signal_without_reentrant_wait(self):
  import json, os, shutil, sys, time, venv
  driver=module('native_setup','scripts/setup/instance.py')
  with tempfile.TemporaryDirectory(prefix='hub-native-stop-') as d:
   root=pathlib.Path(d)/'runtime-test';root.mkdir(mode=0o700)
   for name in ('data','config','logs','home'):(root/name).mkdir(mode=0o700)
   venv.EnvBuilder(with_pip=False).create(root/'venv')
   site=next((root/'venv/lib').glob('python*/site-packages'));pkg=site/'process_runtime';pkg.mkdir();(pkg/'__init__.py').write_text('')
   (pkg/'__main__.py').write_text('import signal,time,sys\nfrom pathlib import Path\np=Path(sys.argv[sys.argv.index("--database")+1]).parent\ndef stop(a,b):\n (p/"graceful").write_text("yes")\n sys.exit(0)\nsignal.signal(signal.SIGTERM,stop)\n(p/"ready").write_text("yes")\nwhile True: time.sleep(.1)\n')
   shutil.copyfile('scripts/setup/instance.py',root/'controller.py');(root/'controller.py').chmod(0o600)
   plan={'root':str(root),'instanceId':'runtime-test','componentId':'process-runtime','config':{'port':19495},'planFile':str(root/'plan.json'),'digest':'test'}
   driver.save(root/'plan.json',plan);driver.save(root/'config/selection.json',plan['config']);driver.save(root/'receipt.json',{'componentId':'process-runtime','configured':True,'controllerSha256':driver.digest(root/'controller.py')})
   try:
    driver.lifecycle('start',plan,root);deadline=time.monotonic()+5
    while not (root/'data/ready').exists():
     self.assertLess(time.monotonic(),deadline);time.sleep(.05)
    started=time.monotonic();result=driver.lifecycle('stop',plan,root)
    self.assertFalse(result['running']);self.assertLess(time.monotonic()-started,5);self.assertTrue((root/'data/graceful').exists())
   finally:
    try:driver.lifecycle('stop',plan,root)
    except Exception:pass

class NativeResumeTests(unittest.TestCase):
 def test_partial_install_resume_preserves_data_and_rejects_changed_artifacts(self):
  import json
  driver=module('native_resume','scripts/setup/instance.py')
  class Environment:
   def __init__(self,**kwargs):pass
   def create(self,p):p.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(prefix='hub-native-resume-') as d:
   base=pathlib.Path(d);root=base/'runtime-test';wheel=base/'test.whl';wheel.write_bytes(b'pinned-test-payload')
   plan={'instanceId':'runtime-test','componentId':'process-runtime','digest':'first-review','artifacts':[{'path':str(wheel),'sha256':driver.digest(wheel)}]}
   with patch.object(driver.venv,'EnvBuilder',Environment),patch.object(driver,'execute',side_effect=RuntimeError('interrupted')):
    with self.assertRaisesRegex(RuntimeError,'interrupted'):driver.install(plan,root)
   (root/'data/keep.txt').write_text('retained application data')
   self.assertFalse((root/'receipt.json').exists())
   changed=base/'other.whl';changed.write_bytes(b'different');wrong={**plan,'artifacts':[{'path':str(changed),'sha256':driver.digest(changed)}]}
   with self.assertRaisesRegex(AssertionError,'partial_install_identity_changed'):driver.install(wrong,root)
   with patch.object(driver.venv,'EnvBuilder',Environment),patch.object(driver,'execute',return_value=None):driver.install({**plan,'digest':'explicit-resume-review'},root)
   self.assertTrue(json.loads((root/'receipt.json').read_text())['installed']);self.assertEqual((root/'data/keep.txt').read_text(),'retained application data')
