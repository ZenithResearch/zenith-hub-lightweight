/** Development-only refresh of the Hub-owned, unpublished proposal. Never edits upstream assets. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from '../src/lib/objects/registry.mjs';
const base='profiles/object-store/ontology/infrastructure',file=base+'/manifest.json';
const manifest=JSON.parse(await readFile(file,'utf8'));
if(manifest.owner!=='ZenithResearch/zenith-hub-lightweight'||manifest.status!=='proposed-unpublished')throw Error('Only the owned unpublished proposal may be refreshed');
const files=[];
async function visit(directory) {for(const entry of await readdir(directory,{withFileTypes:true})) {
 if(entry.isSymbolicLink())throw Error('Proposal assets cannot be symbolic links');
 const name=path.join(directory,entry.name);if(entry.isDirectory())await visit(name);else if(name!==file){const bytes=await readFile(name);files.push({path:path.relative(base,name),bytes:bytes.length,sha256:sha256(bytes)});}
}}
await visit(base);manifest.files=files.sort((a,b)=>a.path.localeCompare(b.path));await writeFile(file,JSON.stringify(manifest,null,2)+'\n');
const registryFile='profiles/object-store/registry.json',registry=JSON.parse(await readFile(registryFile,'utf8'));
const entry=registry.packages.find(p=>p.directory==='ontology/infrastructure');if(!entry)throw Error('Missing owned infrastructure registration');
entry.manifestSha256=sha256(await readFile(file));await writeFile(registryFile,JSON.stringify(registry,null,2)+'\n');
console.log('Refreshed only the unpublished Hub Infrastructure manifest and its catalog pin.');
