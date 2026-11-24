import {constants} from "node:fs";
import {open,rename,unlink,lstat} from "node:fs/promises";
import path from "node:path";
import {OperatorError} from "./pilot-controller.mjs";
export const RESOURCE_SCHEMA="zenith.hub-resources.v1";
export function resourceOrigin(value) {
  const match=typeof value==="string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
  if(!match || Number(match[1])>65535)throw new OperatorError("invalid_resource_endpoint");
  return value;
}
function closed(value,keys) {
  if(!value || typeof value!=="object" || Array.isArray(value) ||
     Object.keys(value).sort().join(",")!==[...keys].sort().join(","))
    throw new OperatorError("invalid_resource_registry");
}
export function validateRegistry(value) {
  closed(value,["schema","revision","resources"]);
  if(value.schema!==RESOURCE_SCHEMA || !Number.isSafeInteger(value.revision) || value.revision<1 ||
     !Array.isArray(value.resources) || value.resources.length>8)
    throw new OperatorError("invalid_resource_registry");
  const ids=new Set();
  for(const r of value.resources) {
    closed(r,["id","kind","label","endpoint","credentialFile","lifecycle","enabled"]);
    if(typeof r.id!=="string" || !/^[a-z][a-z0-9-]{0,63}$/.test(r.id) || ids.has(r.id) ||
       r.kind!=="devgraph" || typeof r.label!=="string" || !r.label.trim() || r.label.length>80 ||
       /[\u0000-\u001f]/.test(r.label) || r.lifecycle!=="external" || typeof r.enabled!=="boolean" ||
       typeof r.credentialFile!=="string" || !path.isAbsolute(r.credentialFile))
      throw new OperatorError("invalid_resource_registry");
    resourceOrigin(r.endpoint);ids.add(r.id);
  }
  return value;
}
export async function privateBytes(file,limit) {
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    if(!info.isFile() || info.uid!==process.getuid() || info.nlink!==1 ||
       (info.mode&0o777)!==0o600 || info.size>limit)
      throw new OperatorError("unsafe_resource_file");
    const data=Buffer.alloc(limit+1);
    const {bytesRead}=await handle.read(data,0,data.length,0);
    if(bytesRead>limit)throw new OperatorError("unsafe_resource_file");
    return data.subarray(0,bytesRead);
  } finally {await handle.close();}
}
export async function readRegistry(file) {
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await privateBytes(file,65536)));
  if(value.schema==='zenith.hub-storage-redirect.v1'){const {applicationForRoot}=await import('./application/owner.mjs');const app=await applicationForRoot(value.setupRoot);if(app.resourcesFile!==file)throw new OperatorError('resource_registry_identity_mismatch',503);return validateRegistry(await app.readResources());}
  return validateRegistry(value);
}
export function publicResource(r) {
  return {id:r.id,kind:r.kind,label:r.label,endpoint:r.endpoint,
          lifecycle:r.lifecycle,enabled:r.enabled,readOnly:true,processControl:false};
}
export async function changeRegistry(file,action) {
  try{const value=JSON.parse((await privateBytes(file,65536)).toString('utf8'));if(value.schema==='zenith.hub-storage-redirect.v1'){const {applicationForRoot}=await import('./application/owner.mjs');const app=await applicationForRoot(value.setupRoot);if(app.resourcesFile!==file)throw new OperatorError('resource_registry_identity_mismatch',503);return app.changeResources(action);}}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!path.isAbsolute(file))throw new OperatorError("invalid_resource_registry_path");
  const parent=await lstat(path.dirname(file));
  if(!parent.isDirectory() || parent.isSymbolicLink() || parent.uid!==process.getuid() || (parent.mode&0o077))
    throw new OperatorError("unsafe_resource_directory");
  let lock;
  try {lock=await open(file+".lock",constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(e) {if(e.code==="EEXIST")throw new OperatorError("resource_registry_busy",409);throw e;}
  try {
    let registry;
    try {registry=await readRegistry(file);}
    catch(e) {if(e.code!=="ENOENT" || action.operation!=="register")throw e;registry={schema:RESOURCE_SCHEMA,revision:1,resources:[]};}
    if(action.expectedRevision!==undefined && registry.revision!==action.expectedRevision)
      throw new OperatorError("resource_registry_changed",409);
    const index=registry.resources.findIndex(r=>r.id===action.resourceId);
    if(action.operation==="register") {
      if(index!==-1)throw new OperatorError("resource_already_registered",409);
      registry.resources.push(action.resource);
    } else if(action.operation==="set-enabled") {
      if(index===-1)throw new OperatorError("resource_not_registered",404);
      if(typeof action.enabled!=="boolean")throw new OperatorError("invalid_resource_action");
      if(registry.resources[index].enabled===action.enabled)return registry;
      registry.resources[index].enabled=action.enabled;
    } else if(action.operation==="forget") {
      if(index===-1)throw new OperatorError("resource_not_registered",404);
      registry.resources.splice(index,1);
    } else throw new OperatorError("invalid_resource_action");
    registry.revision++;validateRegistry(registry);
    const temp=file+".pending";
    const pending=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {await pending.writeFile(JSON.stringify(registry,null,2)+"\n");await pending.sync();}
    finally {await pending.close();}
    await rename(temp,file);
    return registry;
  } finally {await lock.close();await unlink(file+".lock");}
}
