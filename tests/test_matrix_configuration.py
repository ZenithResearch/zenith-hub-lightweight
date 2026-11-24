"""Disposable filesystem fixtures; never start or modify a real homeserver."""
import hashlib, importlib.util, json, shutil, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import yaml
spec=importlib.util.spec_from_file_location('matrix_instance',Path(__file__).parents[1]/'scripts/setup/instance.py')
instance=importlib.util.module_from_spec(spec);spec.loader.exec_module(instance)

class MatrixConfigurationTests(unittest.TestCase):
 def setup_root(self,base):
  root=Path(base)/'matrix-test';root.mkdir(mode=0o700)
  for name in ['config','data','logs','venv']: (root/name).mkdir(mode=0o700)
  shutil.copyfile(instance.__file__,root/'controller.py');(root/'controller.py').chmod(0o600)
  receipt={'schema':'zenith.hub-component-receipt.v1','instanceId':root.name,'componentId':'matrix','root':str(root),'installed':True,'configured':False,'controllerSha256':instance.digest(root/'controller.py'),'artifacts':[{'filename':'fixture.whl','sha256':'a'*64}]}
  instance.save(root/'receipt.json',receipt)
  plan={'instanceId':root.name,'componentId':'matrix','root':str(root),'digest':'first-reviewed-plan','config':{'serverName':'disposable.invalid','port':19408,'access':'private','federation':False},'planFile':str(root/'review.json')}
  instance.save(root/'review.json',plan);return root,plan
 def fake_generate(self,root,plan):
  key=root/'config/disposable.invalid.signing.key';key.write_text('retained signing identity');key.chmod(0o600)
  (root/'data/homeserver.db').write_bytes(b'retained fixture database')
  (root/'data/media').mkdir(exist_ok=True);(root/'data/media/item').write_text('retained media')
  p=root/'config/homeserver.yaml';p.write_text(yaml.safe_dump({'server_name':plan['config']['serverName'],'signing_key_path':str(key),'registration_shared_secret':'retained registration secret'}));p.chmod(0o600)
 def test_interrupted_generation_resumes_without_regeneration_or_data_loss(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory);calls=[]
   def interrupted(argv,_root):
    calls.append(argv)
    if '--generate-config' in argv:self.fake_generate(root,plan)
    else:raise RuntimeError('fixture interruption after generated YAML')
   with patch.object(instance,'execute',side_effect=interrupted):
    with self.assertRaisesRegex(RuntimeError,'fixture interruption'):instance.configure(plan,root)
   before={str(p.relative_to(root)):p.read_bytes() for p in [root/'config/disposable.invalid.signing.key',root/'data/homeserver.db',root/'data/media/item']}
   self.assertFalse(instance.read(root/'receipt.json')['configured'])
   def resume(argv,_root):
    self.assertNotIn('--generate-config',argv)
    instance.matrix_config(plan,root)
   plan['digest']='new-reviewed-retry'
   with patch.object(instance,'execute',side_effect=resume):instance.configure(plan,root)
   self.assertTrue(instance.read(root/'receipt.json')['configured'])
   for rel,data in before.items():self.assertEqual((root/rel).read_bytes(),data)
   configured=yaml.safe_load((root/'config/homeserver.yaml').read_text())
   self.assertFalse(configured['enable_registration']);self.assertEqual(configured['registration_shared_secret'],'retained registration secret')
   self.assertEqual(configured['listeners'][0]['bind_addresses'],['127.0.0.1'])
   self.assertEqual(len([c for c in calls if '--generate-config' in c]),1)
   with patch.object(instance,'execute',side_effect=AssertionError('must not generate')):instance.configure(plan,root)
 def test_identity_change_and_unowned_retained_yaml_are_blocked(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory);self.fake_generate(root,plan);original=(root/'config/homeserver.yaml').read_bytes()
   with self.assertRaisesRegex(AssertionError,'matrix_unowned_configuration'):instance.configure(plan,root)
   self.assertEqual((root/'config/homeserver.yaml').read_bytes(),original)
   intent={'instanceId':root.name,'componentId':'matrix','serverName':'other.invalid','configuration':plan['config'],'root':str(root),'artifacts':instance.read(root/'receipt.json')['artifacts']}
   instance.save(root/'config/matrix-identity.json',intent)
   with self.assertRaisesRegex(AssertionError,'matrix_identity_changed'):instance.configure(plan,root)
 def test_changed_signing_key_or_native_configuration_cannot_be_claimed_current(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory)
   def execute(argv,_root):
    if '--generate-config' in argv:self.fake_generate(root,plan)
    else:instance.matrix_config(plan,root)
   with patch.object(instance,'execute',side_effect=execute):instance.configure(plan,root)
   (root/'config/disposable.invalid.signing.key').write_text('changed key')
   with self.assertRaisesRegex(AssertionError,'matrix_configuration_changed_reconcile'):instance.configure(plan,root)
 def test_retained_database_in_a_different_location_is_not_redirected(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory);self.fake_generate(root,plan)
   database=root/'homeserver.db';database.write_bytes(b'existing accounts and rooms')
   config=root/'config/homeserver.yaml';value=yaml.safe_load(config.read_text());value['database']={'name':'sqlite3','args':{'database':str(database)}};config.write_text(yaml.safe_dump(value));before=config.read_bytes()
   with self.assertRaisesRegex(AssertionError,'matrix_existing_database_location_reconcile'):instance.matrix_config(plan,root)
   self.assertEqual(database.read_bytes(),b'existing accounts and rooms');self.assertEqual(config.read_bytes(),before)
 def test_retained_key_cannot_escape_the_reviewed_instance(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory);self.fake_generate(root,plan);outside=Path(directory)/'outside.signing.key';outside.write_text('outside fixture identity')
   config=root/'config/homeserver.yaml';value=yaml.safe_load(config.read_text());value['signing_key_path']=str(root/'..'/outside.name);config.write_text(yaml.safe_dump(value))
   with self.assertRaisesRegex(AssertionError,'matrix_signing_identity_unresolved'):instance.matrix_config(plan,root)
   self.assertEqual(outside.read_text(),'outside fixture identity')
 def test_live_configuration_lock_prevents_a_second_writer(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory);stamp=instance.subprocess.check_output(['/bin/ps','-p',str(instance.os.getpid()),'-o','lstart=,comm='],text=True).strip()
   instance.save(root/'config/configuration-lock.json',{'root':str(root),'instanceId':root.name,'pid':instance.os.getpid(),'processStamp':stamp,'token':'active'})
   with self.assertRaisesRegex(RuntimeError,'matrix_configuration_still_running'):instance.configure(plan,root)
   self.assertFalse((root/'config/homeserver.yaml').exists())
 def test_missing_yaml_with_retained_key_is_not_regenerated(self):
  with tempfile.TemporaryDirectory() as directory:
   root,plan=self.setup_root(directory)
   expected={'instanceId':root.name,'componentId':'matrix','serverName':plan['config']['serverName'],'configuration':plan['config'],'root':str(root),'artifacts':instance.read(root/'receipt.json')['artifacts']}
   instance.save(root/'config/matrix-identity.json',expected)
   key=root/'config/disposable.invalid.signing.key';key.write_text('do not replace')
   with self.assertRaisesRegex(AssertionError,'matrix_partial_identity'):instance.configure(plan,root)
   self.assertEqual(key.read_text(),'do not replace')
if __name__=='__main__':unittest.main()
