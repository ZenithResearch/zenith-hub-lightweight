import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,rm,readFile,symlink,rename} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createResourceController} from "../../src/lib/resource-controller.mjs";
import {changeRegistry,readRegistry,resourceOrigin} from "../../src/lib/resource-registry.mjs";
const origin="http://127.0.0.1:4218";
const token="dgread1_"+"a".repeat(43);
function request(csrf="",extra={}) {
 return new Request(origin+"/api/resources",{headers:{host:"127.0.0.1:4218",origin,
 "Content-Type":"application/json","X-Zenith-CSRF":csrf,...extra}});
}
async function fixture(t,fetcher) {
 const root=await mkdtemp(path.join(os.tmpdir(),"hub-resource-"));await chmod(root,0o700);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,"resources.json"),credentialFile=path.join(root,"read");
 await writeFile(credentialFile,token,{mode:0o600});
 const resource={id:"example-devgraph",kind:"devgraph",label:"Existing graph",endpoint:"http://127.0.0.1:4220",
 credentialFile,lifecycle:"external",enabled:true};
 await changeRegistry(file,{operation:"register",resourceId:resource.id,resource});
 const calls=[];
 const c=createResourceController({env:{ZENITH_NATIVE_DEMO:"1",ZENITH_HUB_RESOURCES_FILE:file},
 fetcher:fetcher || (async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith("/ready")?{ready:true}:{items:[]});})});
 return {root,file,credentialFile,resource,c,calls};
}
test("an existing graph connects read-only without projecting its credential or provider control",async t=>{
 const {c,calls,credentialFile}=await fixture(t);
 const first=await c.get(request());
 const value=await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"refresh"});
 assert.equal(value.resources[0].state,"connected");
 assert.equal(value.resources[0].lifecycle,"external");assert.equal(value.resources[0].processControl,false);
 assert.equal(value.resources[0].readOnly,true);
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.equal(calls[1].options.headers.Authorization,"Bearer "+token);
 assert.equal(calls[1].options.redirect,"error");
 assert.equal(JSON.stringify(value).includes(token),false);assert.equal(JSON.stringify(value).includes(credentialFile),false);
});
test("connect and disconnect change only a registered binding with revision checks",async t=>{
 const {c,file,calls}=await fixture(t);
 const first=await c.get(request());
 await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"refresh"});
 const disabled=await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"set-enabled",
 resourceId:"example-devgraph",enabled:false,expectedRevision:first.revision});
 assert.equal(disabled.resources[0].state,"disconnected");
 const count=calls.length;
 await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"refresh"});
 assert.equal(calls.length,count);
 assert.equal((await readRegistry(file)).resources[0].enabled,false);
 await assert.rejects(c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"set-enabled",
 resourceId:"example-devgraph",enabled:true,expectedRevision:first.revision}),/resource_registry_changed/);
});
test("cross-origin actions, provider start/stop and browser-selected bindings are rejected",async t=>{
 const {c,file}=await fixture(t),first=await c.get(request()),before=await readFile(file,"utf8");
 const body={schema:"zenith.hub-resource-action.v1",operation:"set-enabled",resourceId:"example-devgraph",
 enabled:false,expectedRevision:first.revision};
 await assert.rejects(c.post(request(first.csrf,{origin:"https://attacker.invalid"}),body),/wrong_origin/);
 await assert.rejects(c.post(request("wrong"),body),/resource_action_forbidden/);
 for(const changed of [{...body,operation:"start"},{...body,operation:"stop"},{...body,credentialFile:"/chosen/file"}])
  await assert.rejects(c.post(request(first.csrf),changed),/invalid_resource_action/);
 assert.equal(await readFile(file,"utf8"),before);
});
test("denied reads remain denied and do not report a connected empty graph",async t=>{
 const {c}=await fixture(t,async url=>Response.json(url.endsWith("/ready")?{ready:true}:{error:"denied"},
 {status:url.endsWith("/ready")?200:403}));
 const first=await c.get(request());
 const value=await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"refresh"});
 assert.equal(value.resources[0].connected,false);assert.equal(value.resources[0].state,"access_denied");
});
test("a symlink or broadly readable credential never reaches the authenticated API",async t=>{
 const {c,credentialFile,calls}=await fixture(t);await chmod(credentialFile,0o644);
 const first=await c.get(request());
 const value=await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"refresh"});
 assert.equal(value.resources[0].state,"credential_unavailable");
 assert.equal(calls.some(v=>v.options.headers.Authorization),false);
 await chmod(credentialFile,0o600);await rename(credentialFile,credentialFile+".real");
 await symlink(credentialFile+".real",credentialFile);
 const linked=await c.post(request(first.csrf),{schema:"zenith.hub-resource-action.v1",operation:"refresh"});
 assert.equal(linked.resources[0].state,"credential_unavailable");
 assert.equal(calls.some(v=>v.options.headers.Authorization),false);
});
test("a GET stays responsive while an external resource is slow",async t=>{
 const {c}=await fixture(t,()=>new Promise(()=>{}));
 const value=await c.get(request());
 assert.equal(value.resources[0].state,"checking");
});
test("hosted mode never reads resource files and unsupported network origins are rejected",async()=>{
 const c=createResourceController({env:{ZENITH_HUB_RESOURCES_FILE:"/not-opened"}});
 assert.equal((await c.snapshot()).mode,"disabled");
 await assert.rejects(c.get(request()),/resources_disabled/);
 for(const endpoint of ["http://localhost:8080","https://remote.invalid:8080","http://127.0.0.1:4220/path",
 "http://127.0.0.1:0","http://2130706433:4220","http://127.0.0.1:4220#fragment"])
 assert.throws(()=>resourceOrigin(endpoint),/invalid_resource_endpoint/);
 assert.equal(resourceOrigin("http://127.0.0.1:8080"),"http://127.0.0.1:8080");
});
