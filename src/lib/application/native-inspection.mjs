/** Bounded read-only verification. No launcher execution, profile/credential reads or inference calls. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bootstrapRelease} from '../setup/hermes-bootstrap.mjs';
import {gunzipSync} from 'node:zlib';
import {sha256,reject} from '../objects/registry.mjs';
import {stableJSON} from '../objects/bundle.mjs';
const fingerprint=v=>sha256(stableJSON(v));
async function fileEvidence(file,{limit=128*1024**2,text=false}={}){
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const before=await handle.stat();if(!before.isFile()||before.uid!==process.getuid()||before.mode&0o022||before.size>limit)reject('unsafe_inspection_file',422);
  const hash=createHash('sha256'),chunks=[],buffer=Buffer.alloc(65536);let count=0;
  while(true){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;count+=bytesRead;if(count>limit)reject('inspection_file_too_large',422);hash.update(buffer.subarray(0,bytesRead));if(text)chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));}
  const after=await handle.stat();if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)reject('inspection_files_changed',409);
  return {dev:after.dev,ino:after.ino,size:after.size,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs,sha256:hash.digest('hex'),...(text?{text:Buffer.concat(chunks).toString('utf8')}:{})};
 }finally{await handle.close();}
}
async function safeDirectory(value){const real=await fs.realpath(value);for(let p=real;;p=path.dirname(p)){const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||(s.mode&0o022)&&!(s.uid===0&&s.mode&0o1000))reject('unsafe_inspection_directory',422);if(path.dirname(p)===p)break;}const s=await fs.stat(real);return {path:real,dev:s.dev,ino:s.ino};}
export async function inspectionRelease(){const bytes=await fs.readFile('profiles/setup/hermes-installer.json'),manifest=JSON.parse(bytes),inventoryBytes=await fs.readFile('profiles/setup/hermes-source.json.gz');if(sha256(inventoryBytes)!==manifest.source.inventorySha256)reject('inspection_adapter_pin_mismatch',503);const bootstrap=await bootstrapRelease();
 return {commit:manifest.source.commit,repository:'https://github.com/NousResearch/hermes-agent',inventory:JSON.parse(gunzipSync(inventoryBytes)).files,pythonHashes:[manifest.tools.python.cacheInventory.find(f=>f.path==='bin/python3.14').sha256,bootstrap.tools.python.cacheInventory.find(f=>f.path==='bin/python3.14').sha256],digest:fingerprint({manifest:sha256(bytes),inventory:sha256(inventoryBytes),implementation:sha256(await fs.readFile(path.join(process.cwd(),'src/lib/application/native-inspection.mjs')))})};
}
export async function verifyHermesCopy(software,{release}={}){
 release ||= await inspectionRelease();
 try{
  if(!software||!['source','environment','runtimeRoot','python'].every(k=>path.isAbsolute(software[k]||'')))reject('installation_layout_unresolved',422);
  const source=await safeDirectory(software.source),environment=await safeDirectory(software.environment),runtime=await safeDirectory(software.runtimeRoot),python=await fs.realpath(software.python),venvPython=await fs.realpath(path.join(environment.path,'bin/python'));
  const runtimePython=await fileEvidence(python);if(!release.pythonHashes.includes(runtimePython.sha256)||python!==venvPython)reject('installed_runtime_unverified',422);
  const stampEvidence=await fileEvidence(path.join(source.path,'install-stamp.json'),{text:true,limit:65536}),stamp=JSON.parse(stampEvidence.text);if(stamp.commit!==release.commit)reject('installed_revision_unqualified',422);
  const venv=await fileEvidence(path.join(environment.path,'pyvenv.cfg'),{limit:65536}),files=[];let index=0;
  if(!release.inventory.some(f=>f.path==='hermes_cli/main.py'))reject('inspection_entrypoint_pin_missing',503);
  await Promise.all(Array.from({length:8},async()=>{while(index<release.inventory.length){const i=index++,entry=release.inventory[i];if(path.isAbsolute(entry.path)||entry.path.split(/[\\/]/).some(v=>v==='..'))reject('unsafe_inspection_inventory',503);const evidence=await fileEvidence(path.join(source.path,entry.path));if(evidence.sha256!==entry.sha256)reject('installed_source_unverified',422);files[i]={path:entry.path,...evidence};}}));
  const locations={source:source.path,environment:environment.path,runtimeRoot:runtime.path},copyIdentity=fingerprint({source:{dev:source.dev,ino:source.ino},environment:{dev:environment.dev,ino:environment.ino}});
  const f=fingerprint({source,environment,runtime,python,runtimePython,stamp:{sha256:stampEvidence.sha256,dev:stampEvidence.dev,ino:stampEvidence.ino,size:stampEvidence.size,mtimeMs:stampEvidence.mtimeMs},venv,files});
  return {state:'present',scope:{key:'hermes-copy:'+copyIdentity,complete:true},fingerprint:{kind:'sha256',sha256:f},copyIdentity,reasons:['Verified pinned source inventory, entry point, Python runtime and environment layout.'],locations,software:{...locations,python},commit:release.commit,repository:release.repository};
 }catch(e){return {state:'unknown',scope:{key:'configured-hermes-locations',complete:false},fingerprint:{kind:'unavailable',reason:e.code||'inspection_failed'},reasons:[e.code||'inspection_failed']};}
}
