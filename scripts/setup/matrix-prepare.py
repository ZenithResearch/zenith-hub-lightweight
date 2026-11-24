"""Reviewed Synapse preparation: exact PyPI inputs, locked Rust build, durable output receipt."""
import argparse, hashlib, json, os, platform, shutil, subprocess, tarfile, time, urllib.request, venv, uuid
from pathlib import Path

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):
 t=p.with_suffix(p.suffix+'.next-'+uuid.uuid4().hex)
 with t.open('x') as f: os.chmod(t,0o600);json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(t,p)
def valid(p,row): return p.is_file() and not p.is_symlink() and p.stat().st_size==row['bytes'] and sha(p)==row['sha256']
def fetch(directory,row):
 target=directory/row['filename']
 if valid(target,row): return target
 assert row['url'].startswith('https://files.pythonhosted.org/packages/')
 pending=target.with_suffix(target.suffix+'.partial')
 assert not pending.is_symlink() and not target.is_symlink()
 with urllib.request.urlopen(row['url'],timeout=30) as r,pending.open('wb') as f:
  count=0
  while chunk:=r.read(1024**2):
   count+=len(chunk);assert count<=row['bytes'],'artifact_size_exceeded';f.write(chunk)
  f.flush();os.fsync(f.fileno())
 assert valid(pending,row),'artifact_integrity_mismatch'
 os.replace(pending,target);return target

def prepare(plan,manifest):
 assert platform.system()=='Darwin' and platform.machine()=='arm64'
 root=Path(plan['preparation']['directory']); root.mkdir(mode=0o700,parents=True,exist_ok=True)
 assert not root.is_symlink() and root.stat().st_uid==os.getuid()
 receipt=root/'receipt.json'
 if receipt.exists():
  old=json.loads(receipt.read_text());assert old['recipeSha256']==plan['preparation']['recipeSha256']
  for r in old['artifacts']: assert sha(root/'wheels'/r['filename'])==r['sha256']
  return
 for d in ('downloads','wheels','logs','cargo','home'): (root/d).mkdir(mode=0o700,exist_ok=True)
 def phase(state,**fields): save(root/'operation.json',{'schema':'zenith.hub-preparation-progress.v1','state':state,'updatedAt':time.time(),'planDigest':plan['digest'],**fields})
 try:
  assert shutil.disk_usage(root).free>=plan['preparation'].get('requiredMiB',1024)*1024**2,'matrix_build_needs_more_free_space'
  rows=[manifest['source'],manifest['build'],*manifest['wheels']]
  for n,row in enumerate(rows):
   phase('downloading-verified-artifacts',completed=n,total=len(rows),artifact=row['filename']);f=fetch(root/'downloads',row)
   if row in manifest['wheels']:shutil.copyfile(f,root/'wheels'/row['filename'])
  phase('building-locked-synapse',completed=len(rows),total=len(rows))
  generation=root/('build-'+uuid.uuid4().hex);generation.mkdir(mode=0o700)
  with tarfile.open(root/'downloads'/manifest['source']['filename']) as t:
   members=t.getmembers();assert len(members)<20000 and sum(m.size for m in members)<256*1024**2
   for m in members: assert not Path(m.name).is_absolute() and '..' not in Path(m.name).parts and (m.isfile() or m.isdir()),'unsafe_source_archive'
   t.extractall(generation,filter='data')
  source=generation/('matrix_synapse-'+manifest['source']['version'])
  # Reuse only build outputs inside this exact recipe cache. Retain failed generations and logs.
  if not (root/'target').exists():
   for previous in sorted(root.glob('build-*')):
    old=previous/('matrix_synapse-'+manifest['source']['version'])/'target'
    if old.is_dir() and not old.is_symlink():old.rename(root/'target');break
  phase('building-locked-synapse',completed=len(rows),total=len(rows),candidate=generation.name)
  venv.EnvBuilder(with_pip=True).create(generation/'venv')
  py=generation/'venv/bin/python'; pins=plan['compiler'];env={'HOME':str(root/'home'),'PATH':str(Path(pins['cargo']['executable']).parent)+':/usr/bin:/bin','CARGO_HOME':str(root/'cargo'),'RUSTC':pins['rustc']['executable'],'CC':pins['clang']['executable'],'LANG':'C.UTF-8','SOURCE_DATE_EPOCH':manifest['sourceDateEpoch'],'PYTHONDONTWRITEBYTECODE':'1','CARGO_INCREMENTAL':'0','CARGO_TARGET_DIR':str(root/'target'),'SDKROOT':pins['sdk']['path']}
  def run(args):
   with (root/'logs/build.log').open('ab') as log: subprocess.run([str(a) for a in args],cwd=source,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,check=True,timeout=1000)
  run([py,'-I','-m','pip','install','--no-index','--no-deps',root/'downloads'/manifest['build']['filename']])
  run([generation/'venv/bin/maturin','build','--release','--locked','--interpreter',py,'--out',root/'wheels'])
  output=list((root/'wheels').glob('matrix_synapse-*.whl'));assert len(output)==1,'unexpected_matrix_build_output'
  artifacts=[{'filename':p.name,'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted((root/'wheels').glob('*.whl'))]
  assert len(artifacts)==len(manifest['wheels'])+1
  save(receipt,{'schema':'zenith.hub-matrix-prepared.v1','state':'prepared','recipeSha256':plan['preparation']['recipeSha256'],'source':manifest['source'],'cargoLockSha256':sha(source/'Cargo.lock'),'compiler':pins,'bootstrap':plan['bootstrap'],'artifacts':artifacts,'planDigest':plan['digest']})
  phase('prepared',completed=len(rows),total=len(rows))
  # Only this disposable generation is removed; keep inputs, Cargo cache, logs and receipt for recovery.
  shutil.rmtree(generation)
  if (root/'target').is_dir() and not (root/'target').is_symlink():shutil.rmtree(root/'target')
 except BaseException:
  phase('preparation-failed-retained',message='Verified downloads and build evidence retained. Review preparation again to retry.');raise

def main():
 os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--plan',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);a=p.parse_args();plan=json.loads(a.plan.read_text());assert sha(a.manifest)==plan['preparation']['recipeSha256'];prepare(plan,json.loads(a.manifest.read_text()))
if __name__=='__main__':main()
