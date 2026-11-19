"""Owned Docker composition; delegates credentials and migrations to Devgraph.

No development verifier, fake credential, direct work writes or host config edits.
Root is used only by the one-shot initializer for its new named volumes.
"""
import argparse,os,pathlib,secrets,stat,subprocess,sys,time,uuid
from devgraph.local_host import LocalHostConfig, provision_local_read_credential, local_read_credential_paths
from devgraph.ontology_sources import ontology_sources
from devgraph.ops.migrate import apply_migrations,load_manifest
from devgraph.runtime import MANIFEST_PATH
from devgraph.storage.neo4j import Neo4jConfig,Neo4jGraphStorage,Neo4jMigrationStore

UID=10001

def private_file(path,raw,owner):
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=owner or stat.S_IMODE(info.st_mode)!=0o600 or path.read_bytes()!=raw:
            raise RuntimeError('Existing secret differs or has unsafe metadata')
    else:
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        if os.geteuid()!=owner:os.chown(path,owner,owner)

def directory(path,owner):
    path.mkdir(exist_ok=True)
    info=path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.is_symlink():raise RuntimeError('Unsafe volume directory')
    if info.st_uid!=owner:
        if info.st_uid!=0 or any(path.iterdir()):raise RuntimeError('Existing volume has unexpected owner')
        os.chown(path,owner,owner)
    os.chmod(path,0o700)

def reader(state,root):
    config=LocalHostConfig.build(data_root=state)
    provision_local_read_credential(config,actor_id='isolated-hub-reader',ttl_seconds=30*24*60*60)
    token,_=local_read_credential_paths(config)
    private_file(root/'devgraph.read',token.read_bytes(),os.geteuid())

def initialize(state,reader_root,auth_root):
    if os.geteuid()!=0:raise RuntimeError('Initializer requires its container root user')
    os.umask(0o077)
    directory(state,UID);directory(reader_root,UID)
    directory(auth_root,7474)
    directory(state/'secrets',UID)
    password_path=state/'secrets/neo4j_password'
    auth_path=auth_root/'neo4j.auth'
    if password_path.exists():
        info=password_path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=UID or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:raise RuntimeError('Unsafe database credential')
        password=password_path.read_bytes()
    else:
        if auth_path.exists():raise RuntimeError('Incomplete database credential state')
        password=secrets.token_hex(32).encode()+b'\n'
        private_file(password_path,password,UID)
    private_file(auth_path,b'neo4j/'+password,7474)
    # Credential provisioning runs with the API's actual UID, not root metadata.
    def drop():os.setgroups([]);os.setgid(UID);os.setuid(UID)
    subprocess.run([sys.executable,__file__,'reader','--state',str(state),'--reader',str(reader_root)],check=True,preexec_fn=drop)
    print('Separate Devgraph credentials initialized; read-only capability; existing values preserved',flush=True)

def serve():
    if not ontology_sources()['closureVerified']:raise RuntimeError('Ontology closure rejected')
    storage=Neo4jGraphStorage(Neo4jConfig.from_env())
    try:
        deadline=time.monotonic()+120
        while not storage.health().ready:
            if time.monotonic()>=deadline:raise RuntimeError('Database readiness deadline exceeded')
            time.sleep(.5)
        result=apply_migrations(load_manifest(MANIFEST_PATH),Neo4jMigrationStore(storage),attempt_id=uuid.uuid4().hex)
        if not result.ready:raise RuntimeError('Canonical migrations stopped safely: '+result.reason)
        print('Canonical Devgraph migrations ready',flush=True)
    finally:storage.close()
    os.execv(sys.executable,[sys.executable,'-m','uvicorn','devgraph.runtime:create_production_app','--factory','--host','0.0.0.0','--port','8080','--no-access-log'])

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['initialize','reader','serve'])
    parser.add_argument('--state',type=pathlib.Path,default=pathlib.Path('/state'));parser.add_argument('--reader',type=pathlib.Path,default=pathlib.Path('/reader'));parser.add_argument('--auth',type=pathlib.Path,default=pathlib.Path('/db-auth'));args=parser.parse_args()
    if args.action=='initialize':initialize(args.state,args.reader,args.auth)
    elif args.action=='reader':reader(args.state,args.reader)
    else:serve()
if __name__=='__main__':main()
