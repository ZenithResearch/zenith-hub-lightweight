"""Allowlisted per-instance native adapter. No shell commands or provider databases."""
import fcntl, re
import argparse, hashlib, json, os, shutil, signal, subprocess, sys, time, uuid, venv, tarfile, secrets
from pathlib import Path

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):
 tmp=p.with_suffix(p.suffix+'.next-'+uuid.uuid4().hex);fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)
def read(p):
 assert p.is_file() and not p.is_symlink() and p.stat().st_uid==os.getuid() and not p.stat().st_mode&0o077
 return json.loads(p.read_text())
def environment(root):return {'HOME':str(root/'home'),'PATH':os.defpath,'LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'}
def execute(argv,root):
 with (root/'logs/adapter.log').open('ab') as log:p=subprocess.run([str(x) for x in argv],cwd=root,stdin=subprocess.DEVNULL,stdout=log,stderr=log,timeout=300,env=environment(root))
 if p.returncode:raise RuntimeError('adapter_failed_inspect_private_log')
def install(plan, root):
    artifacts = [{'filename': Path(f['path']).name, 'sha256': f['sha256']} for f in plan['artifacts']]
    artifact_digest = hashlib.sha256(json.dumps(artifacts, sort_keys=True).encode()).hexdigest()
    for item in plan['artifacts']:
        source = Path(item['path'])
        assert source.is_file() and not source.is_symlink() and digest(source) == item['sha256'], 'artifact_changed'
    if root.exists():
        assert not root.is_symlink() and root.stat().st_uid == os.getuid(), 'invalid_instance_owner'
        if (root/'receipt.json').exists():
            receipt = read(root/'receipt.json')
            assert receipt['componentId'] == plan['componentId'] and receipt['instanceId'] == plan['instanceId'], 'receipt_identity_changed'
            assert receipt['artifacts'] == artifacts, 'installed_artifacts_changed'
            assert digest(root/'controller.py') == receipt['controllerSha256'], 'installed_controller_changed'
            return
        previous = read(root/'operation.json')
        assert previous.get('instanceId') == plan['instanceId'] and previous.get('componentId') == plan['componentId'] and previous.get('artifactDigest') == artifact_digest, 'partial_install_identity_changed'
        assert not owned(root), 'partial_instance_has_active_process'
        # Only the incomplete, installer-owned environment is recreated. Data/config stay intact.
        if (root/'venv').exists():
            assert not (root/'venv').is_symlink(), 'unsafe_partial_environment'
            shutil.rmtree(root/'venv')
    else:
        root.mkdir(mode=0o700, parents=True)
    for name in ['data', 'config', 'logs', 'home', 'wheels']:
        directory = root/name
        assert not directory.is_symlink(), 'unsafe_instance_directory'
        directory.mkdir(mode=0o700, exist_ok=True)
    save(root/'operation.json', {'state':'installing', 'planDigest':plan['digest'], 'instanceId':plan['instanceId'], 'componentId':plan['componentId'], 'artifactDigest':artifact_digest})
    for item in plan['artifacts']:
        source = Path(item['path']); target = root/'wheels'/source.name
        if target.exists():
            assert not target.is_symlink() and digest(target) == item['sha256'], 'retained_wheel_changed'
        else:
            shutil.copyfile(source, target)
    shutil.copyfile(__file__, root/'controller.py'); (root/'controller.py').chmod(0o600)
    venv.EnvBuilder(with_pip=True).create(root/'venv')
    execute([root/'venv/bin/python','-I','-m','pip','install','--no-index','--no-deps','--no-compile',*sorted((root/'wheels').glob('*.whl'))],root)
    execute([root/'venv/bin/python','-I','-m','pip','check'],root)
    save(root/'receipt.json', {'schema':'zenith.hub-component-receipt.v1','instanceId':plan['instanceId'],'componentId':plan['componentId'],'planDigest':plan['digest'],'installed':True,'copyId':uuid.uuid4().hex,'configured':False,'root':str(root),'controllerSha256':digest(root/'controller.py'),'artifacts':artifacts,**({'provenance':{'sourceArchive':plan['runtimePins']['source']}} if plan.get('componentId')=='matrix' and plan.get('runtimePins',{}).get('source') else {})})
    save(root/'operation.json', {'state':'installed','planDigest':plan['digest']})

def _configure(plan,root):
 receipt=read(root/'receipt.json');assert receipt['componentId']==plan['componentId'];config=plan['config'];kind=plan['componentId']
 if receipt['configured']:
  assert read(root/'config/selection.json')==config,'configuration_changed_requires_separate_migration'
  assert not owned(root),'stop_before_binding_refresh'
  if kind=='matrix' and receipt.get('configProof'):
   proof=receipt['configProof'];assert digest(root/'config/homeserver.yaml')==proof['configurationSha256'] and digest(Path(proof['signingKeyPath']))==proof['signingKeySha256'],'matrix_configuration_changed_reconcile'
  assert digest(root/'controller.py')==receipt['controllerSha256'],'existing_controller_changed'
  if kind=='process-runtime' and receipt.get('runtimeRelease'):
   runtime_controller(root,receipt)
   return
  shutil.copyfile(__file__,root/'controller.py');receipt['controllerSha256']=digest(root/'controller.py');receipt['bindingPlanDigest']=plan['digest'];save(root/'receipt.json',receipt)
  return
 if kind=='matrix':
  previous=root/'config/homeserver.yaml'; intent=root/'config/matrix-identity.json'
  expected={'instanceId':plan['instanceId'],'componentId':'matrix','serverName':config['serverName'],'configuration':config,'root':str(root),'artifacts':receipt['artifacts']}
  if intent.exists():
   assert read(intent)==expected,'matrix_identity_changed_requires_reconciliation'
  else:
   assert not previous.exists() and not list(root.rglob('*.signing.key')) and not (root/'data/homeserver.db').exists(),'matrix_unowned_configuration_reconcile'
   save(intent,expected)
  assert not owned(root),'stop_before_configuration'
  if not previous.exists():
   assert not list(root.rglob('*.signing.key')) and not (root/'data/homeserver.db').exists(),'matrix_partial_identity_reconcile'
   execute([root/'venv/bin/python','-m','synapse.app.homeserver','--server-name',config['serverName'],'--config-path',previous,'--generate-config','--report-stats=no'],root)
  # Never regenerate retained signing material. Validate and resume this exact reviewed intent.
  execute([root/'venv/bin/python','-I',Path(__file__).absolute(),'_matrix-config','--plan',plan['planFile']],root)
  receipt['configProof']=read(root/'config/matrix-config-proof.json')
  shutil.copyfile(__file__,root/'controller.py');receipt['controllerSha256']=digest(root/'controller.py')
 elif kind=='frank':
  save(root/'config/frank.json',{'schema':'frank.config.v1','environment':'production','runtime_endpoint':config.get('endpoint','http://127.0.0.1:18092'),'journal':str(root/'data/frank.db'),'allow_local_dev_untrusted':False,'integrations':{'schema':'frank.integrations.v1','integrations':[],'actors':[]}})
 save(root/'config/selection.json',config);receipt['configured']=True;save(root/'receipt.json',receipt)
def configure(plan,root):
 if plan['componentId']!='matrix':return _configure(plan,root)
 lock=root/'config/configuration-lock.json';token=uuid.uuid4().hex
 def stamp(pid):
  result=subprocess.run(['/bin/ps','-p',str(pid),'-o','lstart=,comm='],capture_output=True,text=True)
  assert result.returncode in (0,1),'matrix_configuration_process_unknown'
  return result.stdout.strip() if result.returncode==0 else None
 if lock.exists():
  previous=read(lock);assert previous.get('root')==str(root) and previous.get('instanceId')==plan['instanceId'] and isinstance(previous.get('pid'),int),'matrix_configuration_lock_unresolved'
  if stamp(previous['pid'])==previous.get('processStamp'):raise RuntimeError('matrix_configuration_still_running')
  lock.unlink()
 fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:
  json.dump({'schema':'zenith.hub-configure-lock.v1','root':str(root),'instanceId':plan['instanceId'],'pid':os.getpid(),'processStamp':stamp(os.getpid()),'token':token},f);f.flush();os.fsync(f.fileno())
 try:return _configure(plan,root)
 finally:
  if lock.exists() and read(lock).get('token')==token:lock.unlink()

def matrix_config(plan,root):
 import yaml
 p=root/'config/homeserver.yaml';assert not p.is_symlink() and p.resolve().is_relative_to(root.resolve()),'matrix_configuration_outside_instance';y=yaml.safe_load(p.read_text());config=plan['config'];assert y['server_name']==config['serverName']
 key=Path(y['signing_key_path']);key=key if key.is_absolute() else root/key
 assert key.resolve().is_relative_to(root.resolve()) and key.is_file() and not key.is_symlink(),'matrix_signing_identity_unresolved'
 key.chmod(0o600)
 # An interrupted server may have been started outside the Hub. Never redirect
 # its existing database/media to empty default locations during recovery.
 database=y.get('database',{})
 if database.get('name')=='sqlite3' and database.get('args',{}).get('database'):
  old=Path(database['args']['database']);old=old if old.is_absolute() else root/old
  assert old.resolve().is_relative_to(root.resolve()),'matrix_external_database_reconcile'
  assert not old.is_symlink(),'matrix_unsafe_database'
  assert not old.exists() or old==root/'data/homeserver.db','matrix_existing_database_location_reconcile'
 if y.get('media_store_path'):
  media=Path(y['media_store_path']);media=media if media.is_absolute() else root/media
  assert media.resolve().is_relative_to(root.resolve()) and not media.is_symlink(),'matrix_external_media_reconcile'
  assert not media.exists() or media==root/'data/media' or not any(media.iterdir()),'matrix_existing_media_location_reconcile'
 if not y.get('registration_shared_secret'):y['registration_shared_secret']=secrets.token_hex(32)
 y.update({'pid_file':str(root/'data/homeserver.pid'),'media_store_path':str(root/'data/media'),'enable_registration':False,'report_stats':False,'database':{'name':'sqlite3','args':{'database':str(root/'data/homeserver.db')}},'listeners':[{'port':config['port'],'tls':False,'bind_addresses':['127.0.0.1'],'type':'http','x_forwarded':False,'resources':[{'names':['client']+(['federation'] if config.get('federation') else []),'compress':False}]}]})
 if not config.get('federation'):y['federation_domain_whitelist']=[]
 # Atomic publication prevents a torn YAML file on retry.
 temp=p.with_suffix('.yaml.next-'+uuid.uuid4().hex)
 with temp.open('x') as f:temp.chmod(0o600);f.write(yaml.safe_dump(y));f.flush();os.fsync(f.fileno())
 os.replace(temp,p)
 save(root/'config/matrix-config-proof.json',{'serverName':config['serverName'],'configurationSha256':digest(p),'signingKeyPath':str(key),'signingKeySha256':digest(key)})
def runtime_directory(root, receipt):
    release = receipt.get('runtimeRelease')
    if release is None:
        return root
    generation = release['generation']
    if not isinstance(generation, str) or not re.fullmatch('[a-f0-9]{64}', generation):
        raise ValueError('invalid_runtime_generation')
    directory = root/'runtime-releases'/generation
    if directory.parent.is_symlink() or directory.is_symlink() or not directory.is_dir():
        raise ValueError('unsafe_runtime_generation')
    return directory


def runtime_controller(root, receipt):
    directory = runtime_directory(root, receipt)
    controller = directory/'controller.py'
    expected = receipt.get('runtimeRelease', {}).get('controllerSha256', receipt['controllerSha256'])
    if controller.is_symlink() or digest(controller) != expected:
        raise ValueError('installed_controller_changed')
    return controller


def check_runtime_profile(root, profile):
    names = {'receiver.json', 'admission.json', 'readiness-trust.json'}
    found = {name for name in names if os.path.lexists(root/'config'/name)}
    if set(profile) != found or (found and found != names):
        raise ValueError('runtime_profile_changed')
    for name, expected in profile.items():
        value = read(root/'config'/name)
        if digest(root/'config'/name) != expected:
            raise ValueError('runtime_profile_changed')
        if name == 'admission.json' and value.get('enabled') is not False:
            raise ValueError('close_admission_before_runtime_change')


def change_runtime(action, plan, root):
    receipt_path = root/'receipt.json'
    change = plan['runtimeChange']
    receipt = read(receipt_path)
    if (receipt['componentId'] != 'process-runtime' or plan['componentId'] != 'process-runtime'
            or receipt['instanceId'] != plan['instanceId'] or receipt['root'] != str(root)
            or not receipt['installed'] or not receipt['configured'] or plan['mode'] != 'install'
            or change['action'] != action or not re.fullmatch('[a-f0-9]{64}', plan['digest'])):
        raise ValueError('runtime_identity_changed')
    if receipt.get('lastRuntimeChange') == plan['digest']:
        return
    if digest(receipt_path) != change['receiptSha256'] or read(root/'config/selection.json') != plan['config']:
        raise ValueError('runtime_review_stale')
    if owned(root):
        raise ValueError('stop_before_runtime_change')
    runtime_controller(root, receipt)
    if action == 'rollback-runtime':
        generation = runtime_directory(root, receipt)
        original = generation/'previous-receipt.json'
        if generation == root or digest(original) != receipt['runtimeRelease']['previousReceiptSha256']:
            raise ValueError('rollback_receipt_changed')
        replacement = read(original)
        runtime_controller(root, replacement)
        for row in replacement['artifacts']:
            if digest(root/'wheels'/row['filename']) != row['sha256']:
                raise ValueError('rollback_artifact_changed')
        if not (root/'venv/bin/python').is_file():
            raise ValueError('rollback_environment_missing')
    else:
        if receipt.get('runtimeRelease'):
            raise ValueError('unexpected_runtime_generation')
        profile = change['config']
        check_runtime_profile(root, profile)
        parent = root/'runtime-releases'
        if parent.is_symlink():
            raise ValueError('unsafe_runtime_generation')
        parent.mkdir(mode=0o700, exist_ok=True)
        generation = parent/plan['digest']
        if generation.is_symlink():
            raise ValueError('unsafe_runtime_generation')
        # The active receipt still selects the previous environment under this lock.
        # Only this exact plan's unpublished staging directory can be retried.
        if generation.exists():
            shutil.rmtree(generation)
        generation.mkdir(mode=0o700)
        wheelhouse = generation/'wheels'
        wheelhouse.mkdir(mode=0o700)
        staged = []
        for row in plan['artifacts']:
            source = Path(row['path'])
            if source.name != row['filename'] or not source.name.endswith('.whl') or source.is_symlink():
                raise ValueError('unexpected_runtime_wheel')
            dest = wheelhouse/source.name
            shutil.copyfile(source, dest)
            if dest.stat().st_size != row['bytes'] or digest(dest) != row['sha256']:
                raise ValueError('runtime_wheel_changed')
            staged.append(dest)
        venv.EnvBuilder(with_pip=True).create(generation/'venv')
        python = generation/'venv/bin/python'
        execute([python,'-I','-m','pip','install','--no-index','--no-deps','--no-compile',*staged],root)
        execute([python,'-I','-m','pip','check'],root)
        execute([python,'-I','-m','process_runtime','--help'],root)
        if profile:
            execute([python,'-I','-m','process_runtime.readiness','--database',root/'data/runtime.db',
                     '--receiver-config',root/'config/receiver.json','--admission-policy',root/'config/admission.json'],root)
            execute([python,'-I','-c','from process_runtime.readiness import DeploymentQualification; import sys; DeploymentQualification(sys.argv[1])',
                     root/'config/readiness-trust.json'],root)
        shutil.copyfile(__file__, generation/'controller.py')
        original = generation/'previous-receipt.json'
        shutil.copyfile(receipt_path, original)
        original.chmod(0o600)
        replacement = {**receipt, 'artifacts':[{'filename':p.name,'sha256':digest(p)} for p in staged],
                       'runtimeRelease':{'commit':change['target'], 'generation':generation.name,
                                         'controllerSha256':digest(generation/'controller.py'),
                                         'previousReceiptSha256':digest(original), 'profile':bool(profile)}}
    backup = lifecycle('backup',plan,root)
    if action == 'upgrade-runtime':
        check_runtime_profile(root, change['config'])
    replacement.update(lastRuntimeChange=plan['digest'], runtimeBackupId=backup['backupId'])
    if digest(receipt_path) != change['receiptSha256']:
        raise ValueError('runtime_review_stale')
    save(receipt_path, replacement)


def owned(root):
 marker=root/'process.json'
 if not marker.exists():return None
 m=read(marker)
 p=subprocess.run(['/bin/ps','-ww','-p',str(m['pid']),'-o','command='],capture_output=True,text=True)
 if p.returncode:return None
 started=subprocess.run(['/bin/ps','-p',str(m['pid']),'-o','lstart='],capture_output=True,text=True).stdout.strip()
 controller = root/'controller.py'
 if str(controller) not in p.stdout and (root/'receipt.json').exists():
  controller = runtime_controller(root,read(root/'receipt.json'))
 if str(controller) not in p.stdout or '_serve' not in p.stdout or m['started'] != started:raise RuntimeError('process_ownership_unresolved')
 return m

def serve(plan,root):
 receipt=read(root/'receipt.json');assert digest(root/'controller.py')==receipt['controllerSha256'];assert receipt['configured'];kind=plan['componentId'];config=read(root/'config/selection.json')
 modules={'service-management':'service_management','process-runtime':'process_runtime','matrix':'synapse.app.homeserver','hermes':'gateway.run'};assert kind in modules,'component_has_no_daemon'
 argv=[root/'venv/bin/python','-I','-B','-m',modules[kind]]
 child_env=environment(root);child_cwd=root
 if kind=='hermes':
  software=receipt.get('software',{}); profile=Path(receipt.get('configurationHome') or receipt.get('profile',{}).get('home',str(root/'data'))); app_python=Path(software['environment'])/'bin/python' if software else root/receipt['environment']/'bin/python'
  argv=[app_python,'-B','-m','gateway.run','--config',profile/'config.yaml'];child_env.update({'HERMES_HOME':str(profile),'HERMES_RUNTIME_DIR':software.get('runtimeRoot',str(root/'tools')),'PYTHONDONTWRITEBYTECODE':'1',**read(root/'data/hub-secrets.json')});child_cwd=Path(software.get('source',str(root/'source')))
 if kind=='hermes' and receipt.get('modelRuntimeBinding'):
  binding=receipt['modelRuntimeBinding'];runtime=root/'config/hermes-runtime.py'
  assert digest(runtime)==binding['scriptSha256'],'model_runtime_adapter_changed'
  assert digest(root/'config/hermes-models.json')==binding['manifestSha256'],'model_runtime_manifest_changed'
  # Exact reviewed adapter; source and globally installed executables remain untouched.
  code="import importlib.util;from pathlib import Path;s=importlib.util.spec_from_file_location('hub_runtime',"+repr(str(runtime))+");m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.launch(Path("+repr(str(root))+"))"
  argv=[app_python,'-B','-c',code]
 elif kind=='hermes':pass
 elif kind=='matrix':argv+=['--config-path',root/'config/homeserver.yaml']
 else:argv+=['--database',root/'data'/('runtime.db' if kind=='process-runtime' else 'service.db'),'--port',str(config['port']),'--environment','production']
 if kind=='process-runtime' and receipt.get('runtimeRelease'):
  argv[0] = runtime_directory(root,receipt)/'venv/bin/python'
  if receipt['runtimeRelease']['profile']:
   argv.extend(['--receiver-config',root/'config/receiver.json','--admission-policy',root/'config/admission.json','--readiness-trust',root/'config/readiness-trust.json'])
 with (root/'logs/service.log').open('ab') as log:
  child=subprocess.Popen([str(x) for x in argv],cwd=child_cwd,env=child_env,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
  stopping={'deadline':None}
  def stop(_s,_f):
   # A signal handler must never re-enter Popen.wait while the main wait holds its lock.
   stopping['deadline']=time.monotonic()+15
   try:os.kill(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  started=subprocess.check_output(['/bin/ps','-p',str(os.getpid()),'-o','lstart='],text=True).strip();save(root/'process.json',{'pid':os.getpid(),'childPid':child.pid,'generation':uuid.uuid4().hex,'started':started})
  while child.poll() is None:
   try:child.wait(timeout=.2)
   except subprocess.TimeoutExpired:
    if stopping['deadline'] is not None and time.monotonic()>stopping['deadline']:
     child.kill();stopping['deadline']=None
  code=child.wait();save(root/'exit.json',{'code':code,'time':time.time()})
def lifecycle(action,plan,root):
 if action=='backup':
  assert not owned(root),'stop_before_consistent_backup'
  backup=root.parent.parent/'backups'/plan['instanceId'];backup.mkdir(mode=0o700,parents=True,exist_ok=True);identifier=uuid.uuid4().hex;archive=backup/(identifier+'.tar.gz')
  with tarfile.open(archive,'w:gz') as tar:
   for directory in ('data','config','profiles'):
    for file in (root/directory).rglob('*'):
     assert not file.is_symlink(),'backup_symlink_rejected'
     if file.is_file():tar.add(file,arcname=str(file.relative_to(root)),recursive=False)
  archive.chmod(0o600);receipt={'schema':'zenith.hub-backup.v1','id':identifier,'instanceId':plan['instanceId'],'componentId':plan['componentId'],'serverName':plan['config'].get('serverName'),'sourceRoot':str(root),'archiveSha256':digest(archive),'createdAt':time.time(),'softwareReceipt':read(root/'receipt.json')}
  save(backup/(identifier+'.json'),receipt);return {'backupId':identifier,'archive':str(archive),'sha256':receipt['archiveSha256'],'dataPreserved':True}
 if action=='status':return {'running':bool(owned(root))}
 if action=='stop':
  m=owned(root)
  if m:
   os.kill(m['pid'],signal.SIGTERM);deadline=time.monotonic()+25
   while owned(root):
    if time.monotonic()>deadline:raise RuntimeError('shutdown_unresolved')
    time.sleep(.1)
  return {'running':False,'dataPreserved':True}
 assert action=='start'
 if owned(root):return {'running':True}
 receipt=read(root/'receipt.json');assert receipt['configured'] and digest(root/'controller.py')==receipt['controllerSha256']
 wrapper_python=(Path(receipt['software']['environment'])/'bin/python' if receipt.get('software') else root/receipt['environment']/'bin/python') if receipt['componentId']=='hermes' else root/'venv/bin/python'
 controller = runtime_controller(root,receipt) if receipt.get('runtimeRelease') else root/'controller.py'
 if receipt.get('runtimeRelease'):wrapper_python=controller.parent/'venv/bin/python'
 with (root/'logs/wrapper.log').open('ab') as log:subprocess.Popen([str(wrapper_python),'-I','-B',str(controller),'_serve','--plan',plan['planFile']],cwd=root,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,env=environment(root))
 deadline=time.monotonic()+10
 while not owned(root):
  if time.monotonic()>deadline:raise RuntimeError('start_outcome_unknown_inspect_receipt')
  time.sleep(.1)
 return {'running':True}
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['install','configure','start','stop','status','backup','upgrade-runtime','rollback-runtime','runtime-change-idle','_serve','_matrix-config']);p.add_argument('--plan',type=Path,required=True);a=p.parse_args();plan=read(a.plan);root=Path(plan['root']).absolute();assert root.name==plan['instanceId'] and not root.is_symlink()
 guard=None
 if plan['componentId']=='process-runtime' and a.action in ('upgrade-runtime','rollback-runtime','runtime-change-idle','start','stop','configure','backup'):
  guard=os.open(root,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
  fcntl.flock(guard,fcntl.LOCK_EX | fcntl.LOCK_NB)
 if a.action=='runtime-change-idle':return
 if a.action in ('upgrade-runtime','rollback-runtime'):change_runtime(a.action,plan,root)
 elif a.action=='install':install(plan,root)
 elif a.action=='configure':configure(plan,root)
 elif a.action=='_matrix-config':matrix_config(plan,root)
 elif a.action=='_serve':serve(plan,root)
 else:print(json.dumps(lifecycle(a.action,plan,root)))
if __name__=='__main__':main()
