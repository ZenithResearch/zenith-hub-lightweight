/** Private immutable representations, staged and synced before any SQLite pointer is published. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256,reject} from './registry.mjs';
export async function privateDirectory(directory) {
  if(!path.isAbsolute(directory))reject('invalid_hub_data_directory',503);
  for(let p=directory;;p=path.dirname(p)){try{const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||(s.mode&0o022)&&!(s.uid===0&&s.mode&0o1000))reject('unsafe_hub_data_directory',503);}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}
  await fs.mkdir(directory,{recursive:true,mode:0o700});const s=await fs.lstat(directory);if(s.uid!==process.getuid()||s.mode&0o077)reject('unsafe_hub_data_directory',503);return s;
}
export async function privateDatabaseFile(directory,{create=true}={}) {
  await privateDirectory(directory);const supported=process.platform==='darwin'?[17,26]:process.platform==='linux'?[0xef53,0x1021994,0x794c7630,0x58465342,0x9123683e]:[];if(!supported.includes((await fs.statfs(directory)).type))reject('unsupported_repository_filesystem',503);const file=path.join(directory,'objects.sqlite');
  if(create){try{const f=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await f.close();}catch(e){if(e.code!=='EEXIST')throw e;}}
  for(const suffix of ['','-wal','-shm']){try{const s=await fs.lstat(file+suffix);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1||s.mode&0o077)reject('unsafe_hub_database',503);}catch(e){if(suffix&&e.code==='ENOENT')continue;throw e;}}
  return file;
}
async function syncDirectory(directory){const f=await fs.open(directory,constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
export class Representations {
  constructor(directory,{fault=()=>{}}={}){this.dataDir=directory;this.root=path.join(directory,'representations');this.fault=fault;}
  async initialize(){const parent=await privateDirectory(this.dataDir);await privateDirectory(this.root);for(const folder of ['.staging','objects','bindings','definitions']){const s=await privateDirectory(path.join(this.root,folder));if(s.dev!==parent.dev)reject('cross_volume_storage_unsupported',503);}await syncDirectory(this.root);await syncDirectory(this.dataDir);}
  encode(value,folder,extension='json'){return this.encodeBytes(Buffer.from(JSON.stringify(value,null,2)+'\n'),folder,extension);}
  encodeBytes(bytes,folder,extension='json'){
    if(!['objects','bindings','definitions'].includes(folder)||!['json','jsonld'].includes(extension)||bytes.length>5*1024**2)reject('invalid_representation',422);
    const digest=sha256(bytes);return {bytes,ref:{storageKey:folder+'/'+digest+'.'+extension,artifact:{id:'urn:sha256:'+digest,sha256:digest,byteLength:bytes.length,mediaType:extension==='jsonld'?'application/ld+json':'application/json'}}};
  }
  async readBytes(ref){
    if(!/^(objects|bindings|definitions)\/[a-f0-9]{64}\.(json|jsonld)$/.test(ref.storageKey)||ref.artifact.id!=='urn:sha256:'+ref.artifact.sha256||ref.storageKey.split('/')[1].split('.')[0]!==ref.artifact.sha256)reject('invalid_representation_reference',503);
    const file=path.join(this.root,ref.storageKey);for(const dir of [this.dataDir,this.root,path.dirname(file)]){const s=await fs.lstat(dir);if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==process.getuid()||s.mode&0o077)reject('unsafe_representation_path',503);}
    const f=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||s.mode&0o077||s.size>5*1024**2)reject('unsafe_representation',503);const b=await f.readFile();if(b.length!==ref.artifact.byteLength||sha256(b)!==ref.artifact.sha256)reject('repository_integrity_failure',503);return b;}finally{await f.close();}
  }
  async read(ref){return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await this.readBytes(ref)));}
  async publish(encoded){
    const items=[...new Map(encoded.map(v=>[v.ref.storageKey,v])).values()],stage=path.join(this.root,'.staging',randomUUID());await privateDirectory(stage);
    for(let i=0;i<items.length;i++){
      const item=items[i],temp=path.join(stage,String(i)),target=path.join(this.root,item.ref.storageKey);const f=await fs.open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      try{await f.writeFile(item.bytes);await this.fault('file-write');if(sha256(await fs.readFile(temp))!==item.ref.artifact.sha256)reject('representation_verification_failed',503);await this.fault('file-verification');await f.sync();await this.fault('file-sync');}finally{await f.close();}
      try{await this.readBytes(item.ref);await fs.unlink(temp);}catch(e){if(e.code!=='ENOENT')throw e;await fs.rename(temp,target);}
      await this.fault('file-rename');await syncDirectory(path.dirname(target));await this.fault('directory-sync');await this.readBytes(item.ref);
    }
    await syncDirectory(stage);await fs.rmdir(stage);await syncDirectory(path.dirname(stage));
  }
}
