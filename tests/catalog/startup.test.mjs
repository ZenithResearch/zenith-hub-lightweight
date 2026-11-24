import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from './helpers.mjs';
import {atomic} from '../../src/lib/setup/state.mjs';
const cli=(root,...args)=>new Promise((resolve,reject)=>{const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('ZENITH_')))},p=spawn(process.execPath,['scripts/hub.mjs',...args,'--setup-dir',root],{env,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('exit',code=>resolve({code,out,err}));});
test('CLI synchronizes an initialized pre-catalog root once before UI startup and repeated prepare is a DB no-op',async t=>{
 const f=await fixture(t,{legacy:true});await f.init();const old=await f.app.status(),setup=await f.app.readSetup();
 await atomic(path.join(f.root,'application.json'),{schema:'zenith.hub-application-activation.v1',setupRoot:f.root,dataDir:f.options.dataDir,resourcesFile:f.options.resourcesFile,repositoryId:old.repositoryId,definitionSetId:old.definitionSetId});await f.app.close();
 const unavailable=await cli(f.root,'catalog','status');assert.equal(unavailable.code,0,unavailable.err);assert.equal(JSON.parse(unavailable.out).state,'unavailable');
 const first=await cli(f.root,'prepare');assert.equal(first.code,0,first.out+first.err);const initial=JSON.parse(first.out);assert.equal(initial.catalog.state,'ready');assert.ok(initial.generation>old.generation);assert.equal(initial.definitionSetId,old.definitionSetId);
 const second=await cli(f.root,'prepare');assert.equal(second.code,0,second.out+second.err);assert.equal(JSON.parse(second.out).generation,initial.generation);await assert.rejects(fs.stat(path.join(f.root,'server.json')),{code:'ENOENT'});
 await f.reopen();assert.deepEqual(await f.app.readSetup(),setup);assert.equal((await f.app.catalogService.registry()).byId.size,6);
});
