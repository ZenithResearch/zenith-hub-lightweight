"""Pinned Hermes source installer using its own frozen PM build API, with private instance state."""
import argparse, hashlib, json, os, shutil, subprocess, tarfile, tempfile, urllib.request, gzip, uuid
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
INSTALLER_STARTED=subprocess.check_output(['/bin/ps','-p',str(os.getpid()),'-o','lstart='],text=True).strip()
def save(p,v):
 if p.name=='operation.json':v={**v,'installerPid':os.getpid(),'installerStarted':INSTALLER_STARTED}
 pending=p.with_suffix(p.suffix+'.pending-'+uuid.uuid4().hex)
 with pending.open('x') as f:
  os.chmod(pending,0o600);json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(pending,p)
def fetch(url,target,expected=None,limit=512*1024**2):
 pending=target.with_suffix(target.suffix+'.partial')
 try:
  with urllib.request.urlopen(url,timeout=30) as r,pending.open('wb') as f:
   size=0
   while chunk:=r.read(1024*1024):
    size+=len(chunk)
    if size>limit:raise RuntimeError('artifact_exceeds_limit')
    f.write(chunk)
  if expected and sha(pending)!=expected:raise RuntimeError('artifact_hash_mismatch')
  os.replace(pending,target)
 except Exception:
  # Retain the partial receipt; never treat partial bytes as an installed artifact.
  raise

def extract(archive,destination,strip_first=False,allowed=None):
 destination.mkdir(mode=0o700,parents=True,exist_ok=True)
 with tarfile.open(archive) as tar:
  members=tar.getmembers();assert len(members)<50000 and sum(m.size for m in members)<2*1024**3
  for m in members:
   p=Path(m.name);assert not p.is_absolute() and '..' not in p.parts
   if strip_first:p=Path(*p.parts[1:])
   if not p.parts:continue
   if allowed is not None and str(p) not in allowed:continue
   target=destination/p
   if m.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True);continue
   if m.issym():
    link=Path(m.linkname);assert not link.is_absolute();resolved=(target.parent/link).resolve();assert resolved.is_relative_to(destination.resolve()),'unsafe_archive_link'
    target.parent.mkdir(mode=0o700,parents=True,exist_ok=True);target.symlink_to(link);continue
   assert m.isfile(),'unsupported_source_archive_entry'
   target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   with tar.extractfile(m) as f,target.open('wb') as out:shutil.copyfileobj(f,out)
   target.chmod(0o700 if m.mode&0o111 else 0o600)

def install(plan,root,source_manifest,source_cache=None,tool_cache=None):
 source=source_manifest['source'];inventory=source_manifest['inventory']
 if root.exists():
  op=json.loads((root/'operation.json').read_text());assert op['sourceCommit']==source['commit'],'instance_identity_changed'
  assert not (root/'receipt.json').exists(),'already_installed_connect_or_upgrade_explicitly'
 else:
  root.mkdir(mode=0o700,parents=True)
  for d in ('data','config','logs','home','tools','cache','source'):(root/d).mkdir(mode=0o700)
  save(root/'operation.json',{'schema':'zenith.hub-hermes-operation.v1','sourceCommit':source['commit'],'state':'preparing-source','planDigest':plan['digest']})
 for d in ('data','config','logs','home','tools','cache','source'):
  q=root/d;assert not q.is_symlink(),'unsafe_instance_directory';q.mkdir(mode=0o700,exist_ok=True)
 save(root/'operation.json',{'sourceCommit':source['commit'],'state':'preparing-source','planDigest':plan['digest']})
 if source_cache:
  src=Path(source_cache)
  for item in inventory['files']:
   p=src/item['path'];assert p.is_file() and not p.is_symlink() and sha(p)==item['sha256'],'source_cache_mismatch'
   q=root/'source'/item['path'];q.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   if q.is_file() and not q.is_symlink() and sha(q)==item['sha256']:continue
   shutil.copyfile(p,q);q.chmod(0o700 if item['mode']=='100755' else 0o600)
 else:
  archive=root/'cache/source.tar.gz';fetch(source['url'],archive,source.get('archiveSha256'));extract(archive,root/'source',strip_first=True,allowed={r['path'] for r in inventory['files']})
  for item in inventory['files']:
   p=root/'source'/item['path'];assert p.is_file() and not p.is_symlink() and sha(p)==item['sha256'],'source_integrity_mismatch'
 tools=source_manifest['tools']
 for name,row in tools.items():
  save(root/'operation.json',{'sourceCommit':source['commit'],'state':'preparing-runtime-'+name,'planDigest':plan['digest']})
  directory=root/'tools'/row['directory']
  if directory.exists() and (root/'cache'/(row['directory']+'.complete')).exists():continue
  if tool_cache:
   # The cache is operator-owned public build input. Its tool facts are reverified by PM.
   src=Path(tool_cache)/row['directory'];assert src.is_dir() and not src.is_symlink()
   for item in row['cacheInventory']:
    q=src/item['path'];assert q.is_file() and not q.is_symlink() and sha(q)==item['sha256'],'runtime_cache_integrity_mismatch'
   expected={i['path'] for i in row['cacheInventory']};actual={str(q.relative_to(src)) for q in src.rglob('*') if q.is_file() and not q.is_symlink()};assert actual==expected,'unexpected_runtime_cache_file'
   for link in src.rglob('*'):
    if link.is_symlink():assert link.resolve().is_relative_to(src.resolve()),'external_runtime_cache_link'
   directory.mkdir(mode=0o700,parents=True,exist_ok=True)
   for q in src.rglob('*'):
    out=directory/q.relative_to(src)
    if q.is_symlink():
     if not out.exists() and not out.is_symlink():out.parent.mkdir(mode=0o700,parents=True,exist_ok=True);out.symlink_to(os.readlink(q))
    elif q.is_dir():out.mkdir(mode=0o700,parents=True,exist_ok=True)
    elif q.is_file():
     out.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(q,out);out.chmod(0o700 if q.stat().st_mode&0o111 else 0o600)
  else:
   if name not in ('python','uv'):continue
   archive=root/'cache'/(name+'.tar.gz');fetch(row['url'],archive,row['sha256']);extract(archive,directory,strip_first=True)
  (root/'cache'/(row['directory']+'.complete')).write_text(row['sha256'])
 # Only the package authority's public tool facts travel with these exact verified tools.
 save(root/'tools/facts.json',{'schema':1,'packages':{name:row['fact'] for name,row in tools.items() if (root/'cache'/(row['directory']+'.complete')).exists()}})
 # Build at a new final generation, preserving incomplete generations for reconciliation.
 generation=root/('environment-'+uuid.uuid4().hex);python=root/'tools'/tools['python']['directory']/'bin/python3'
 (root/'cache/tmp').mkdir(mode=0o700,exist_ok=True)
 env={'TMPDIR':str(root/'cache/tmp'),'HOME':str(root/'home'),'HERMES_HOME':str(root/'data'),'HERMES_RUNTIME_DIR':str(root/'tools'),'UV_CACHE_DIR':str(root/'cache/uv'),'PATH':str(root/'tools'/tools['uv']['directory'])+':/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'}
 save(root/'operation.json',{'sourceCommit':source['commit'],'state':'building-frozen-environment','candidate':generation.name,'planDigest':plan['digest']})
 with (root/'logs/install.log').open('ab') as log:
  result=subprocess.run([str(python),'-B','-m','pm.build_env','--source',str(root/'source'),'--out',str(generation),'--extra','messaging','--sealed','--cache',str(root/'cache/uv')],cwd=root/'source',env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,timeout=900)
 assert result.returncode==0,'hermes_frozen_build_failed_retained'
 with (root/'logs/install.log').open('ab') as log:
  # Hermes owns native tool formats and the complete required runtime closure.
  completed=subprocess.run([str(python),'-B','-m','pm.cli','install','--tools-only','--without','agent-browser','--without','cua-driver'],cwd=root/'source',env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,timeout=900)
  assert completed.returncode==0,'hermes_required_tools_incomplete'
  stamp=subprocess.run([str(python),'-B',str(root/'source/scripts/write_install_stamp.py'),'--output',str(root/'source/install-stamp.json'),'--commit',source['commit'],'--source','hub','--update-mechanism','external','--runtime-dir',str(root/'tools')],cwd=root/'source',env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,timeout=60)
  assert stamp.returncode==0,'hermes_source_receipt_incomplete'
 check=subprocess.run([str(generation/'bin/python'),'-B','-c','from gateway.platforms.api_server import APIServerAdapter; from hermes_cli.tools_config import _get_platform_tools; assert not _get_platform_tools({"platform_toolsets":{"api_server":[]}},"api_server")'],cwd=root/'source',env=env,capture_output=True,timeout=60)
 assert check.returncode==0,'hermes_api_import_failed'
 save(root/'receipt.json',{'schema':'zenith.hub-component-receipt.v1','componentId':'hermes','instanceId':plan['instanceId'],'installed':True,'configured':False,'root':str(root),'source':source,'environment':generation.name,'planDigest':plan['digest']})
 save(root/'operation.json',{'sourceCommit':source['commit'],'state':'installed','planDigest':plan['digest']})

def main():
 p=argparse.ArgumentParser();p.add_argument('--plan',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--inventory',type=Path,required=True);p.add_argument('--source-cache',type=Path);p.add_argument('--tool-cache',type=Path);a=p.parse_args()
 plan=json.loads(a.plan.read_text());manifest=json.loads(a.manifest.read_text());assert sha(a.inventory)==manifest['source']['inventorySha256'];manifest['inventory']=json.loads(gzip.decompress(a.inventory.read_bytes()))
 try:install(plan,Path(plan['root']),manifest,a.source_cache,a.tool_cache)
 except Exception:
  root=Path(plan['root'])
  if root.exists():
   prior=json.loads((root/'operation.json').read_text()) if (root/'operation.json').exists() else {}
   save(root/'operation.json',{**prior,'sourceCommit':manifest['source']['commit'],'state':'failed-retained','planDigest':plan['digest']})
  raise
if __name__=='__main__':main()
