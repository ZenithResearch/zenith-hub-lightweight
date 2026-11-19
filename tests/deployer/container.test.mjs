import test from "node:test";
import assert from "node:assert/strict";
import {createContainerController} from "../../src/lib/container-controller.mjs";
import {normalizeNextRequest} from "../../src/lib/operator-http.mjs";
const origin="http://127.0.0.1:4218";
function request(actual=origin,host="127.0.0.1:4218",supplied=origin) {return new Request(actual+"/api/deployer",{headers:{host,origin:supplied}});}
test("container status is fixed, read-only and never reports native authority",async()=>{
 const urls=[]; const c=createContainerController({env:{ZENITH_CONTAINER_DEMO:"1"},fetcher:async(url)=>{urls.push(url);return Response.json({ready:true});}});
 const v=await c.get(request()); assert.deepEqual(urls.sort(),["http://127.0.0.1:8091/ready","http://127.0.0.1:8092/ready"]);
 assert.equal(v.profile,"process-docker-demo-v1");assert.equal(v.status.external_effects,false);assert.equal(v.status.pilot_ready,false);assert.deepEqual(v.actions,[]);
 assert.throws(()=>c.admitMutation(request()),/compose_managed_read_only/);
 await assert.rejects(c.post(request(),{}),/compose_managed_read_only/);
 await assert.rejects(c.get(request(origin,"attacker.invalid")),/wrong_origin/);
 await assert.rejects(c.get(request(origin,"127.0.0.1:4218","https://attacker.invalid")),/wrong_origin/);
});
test("container health failure cannot appear ready",async()=>{
 const c=createContainerController({env:{ZENITH_CONTAINER_DEMO:"1"},fetcher:async()=>{throw Error("offline");}});
 assert.ok((await c.get(request())).status.components.every(c=>c.ready===false && c.live===false));
});
test("container mode is opt-in and accepts only its fixed internal URL",async()=>{
 await assert.rejects(createContainerController({env:{}}).get(request()),/container_demo_disabled/);
 const internal=request("http://0.0.0.0:4218");
 assert.throws(()=>normalizeNextRequest(internal,origin),/wrong_host/);
 assert.equal(new URL(normalizeNextRequest(internal,origin,true).url).origin,origin);
 assert.throws(()=>normalizeNextRequest(request("http://evil.invalid"),origin,true),/wrong_host/);
 assert.throws(()=>normalizeNextRequest(request("http://0.0.0.0:4218","evil.invalid"),origin,true),/wrong_host/);
});

test("native demo reports its own profile and isolated ports",async()=>{
 const urls=[]; const c=createContainerController({env:{ZENITH_NATIVE_DEMO:"1"},fetcher:async(url)=>{urls.push(url);return Response.json({ready:true});}});
 const v=await c.get(request());assert.equal(v.profile,"process-native-demo-v1");assert.deepEqual(urls.sort(),["http://127.0.0.1:18091/ready","http://127.0.0.1:18092/ready"]);assert.deepEqual(v.actions,[]);
});
