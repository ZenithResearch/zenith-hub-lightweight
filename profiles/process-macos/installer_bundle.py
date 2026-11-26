"""Fetch a pinned released installer only after the user applies installation."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.request
import uuid
import zipfile

class InstallerError(ValueError):
    pass

def require(value,message):
    if not value:raise InstallerError(message)

def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def descriptor(path):
    value=json.loads(Path(path).read_text())
    keys={'schema','url','archiveSha256','archiveBytes','bundleSha256','profileSha256'}
    require(isinstance(value,dict) and set(value)==keys and value['schema']=='hub.released-installer.v1','Invalid installer descriptor')
    require(re.fullmatch(r'https://github\.com/ZenithResearch/zenith-hub-lightweight/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.zip',value['url']) is not None,'Unrecognized installer origin')
    require(all(isinstance(value[k],str) and re.fullmatch('[a-f0-9]{64}',value[k]) for k in ['archiveSha256','bundleSha256','profileSha256']),'Invalid installer digest')
    require(type(value['archiveBytes']) is int and 0<value['archiveBytes']<=64*1024**2,'Invalid installer size')
    require(digest(Path(path).parent/'release.v1.json')==value['profileSha256'],'Installer profile differs from release')
    return value

def private_directory(path):
    for parent in (path,*path.parents):
        require(not parent.is_symlink(),'Installer cache cannot traverse symlinks')
        if parent.exists():
            info=parent.stat()
            require(info.st_uid in (0,os.getuid()) and (not info.st_mode&0o022 or info.st_uid==0 and info.st_mode&stat.S_ISVTX),'Unsafe installer cache ancestor')
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    info=path.stat()
    require(info.st_uid==os.getuid() and not info.st_mode&0o077,'Installer cache must be owner-private')

def validate_bundle(bundle,value,controller):
    require(bundle.is_dir() and not bundle.is_symlink(),'Invalid cached installer')
    require(all((bundle/name).is_file() and not (bundle/name).is_symlink() for name in ['bundle.json','profile.json']),'Invalid cached installer manifests')
    require(digest(bundle/'bundle.json')==value['bundleSha256'] and digest(bundle/'profile.json')==value['profileSha256'],'Cached installer differs from release')
    spec=importlib.util.spec_from_file_location('released_mac_controller',controller)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    try:
        module.check_bundle(bundle,value['bundleSha256'])
    except ValueError as error:
        # Only use names from the already authenticated manifest for diagnostics.
        for name, expected in json.loads((bundle/'bundle.json').read_text())['files'].items():
            member=bundle/name
            if (any(p.is_symlink() for p in (member,*member.parents)) or
                    not member.is_file() or digest(member)!=expected):
                raise InstallerError('Installer verification failed for '+name) from error
        raise

def extract(archive,destination):
    with zipfile.ZipFile(archive) as package:
        entries=package.infolist()
        require(len(entries)<=4096 and sum(v.file_size for v in entries)<=128*1024**2,'Oversize installer contents')
        seen=set()
        for item in entries:
            name=item.filename;relative=Path(name)
            require(name and not relative.is_absolute() and '..' not in relative.parts and '\\' not in name and stat.S_IFMT(item.external_attr>>16)!=stat.S_IFLNK,'Unsafe installer archive member')
            require(name.casefold() not in seen,'Duplicate installer archive member');seen.add(name.casefold())
            target=destination/relative
            if item.is_dir():target.mkdir(parents=True,exist_ok=True,mode=0o700);continue
            target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with package.open(item) as source,target.open('xb') as output:
                while raw:=source.read(1024**2):output.write(raw)

def ensure(path,cache,*,opener=urllib.request.urlopen):
    os.umask(0o077)
    path=Path(path);cache=Path(cache).absolute();value=descriptor(path)
    private_directory(cache)
    target=cache/value['bundleSha256']
    controller=path.parent/'process_mac.py'
    if target.exists():
        validate_bundle(target,value,controller);return target
    stage=cache/('prepare-'+uuid.uuid4().hex);stage.mkdir(mode=0o700)
    archive=stage/'installer.zip';deadline=time.monotonic()+180
    request=urllib.request.Request(value['url'],headers={'User-Agent':'Zenith-Hub-Installer'})
    with opener(request,timeout=30) as response,archive.open('xb') as output:
        require(response.geturl().startswith('https://'),'Installer redirect must retain HTTPS')
        size=0
        while raw:=response.read(1024**2):
            size+=len(raw);require(size<=value['archiveBytes'] and time.monotonic()<deadline,'Installer download exceeded its bounds')
            output.write(raw)
    require(size==value['archiveBytes'] and digest(archive)==value['archiveSha256'],'Installer archive digest differs')
    unpacked=stage/'bundle';unpacked.mkdir(mode=0o700);extract(archive,unpacked)
    validate_bundle(unpacked,value,controller)
    unpacked.rename(target)
    return target

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--descriptor',type=Path,required=True)
    parser.add_argument('--cache',type=Path,required=True)
    args=parser.parse_args()
    bundle=ensure(args.descriptor,args.cache)
    print(json.dumps({'schema':'hub.prepared-installer.v1','bundle':str(bundle),'bundleSha256':digest(bundle/'bundle.json')}))

if __name__=='__main__':main()
