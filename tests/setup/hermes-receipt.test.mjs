import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {softwareFromHermesReceipt} from '../../src/lib/setup/hermes-receipt.mjs';

test('source-installer layout resolves without configuration, profiles, launchers or execution',async()=>{
 const root='/synthetic/instances/hermes',receipt={componentId:'hermes',instanceId:'hermes',installed:true,configured:false,environment:'environment-deadbeef'},manifest=JSON.parse(await readFile('profiles/setup/hermes-installer.json'));
 const original=structuredClone(receipt),software=await softwareFromHermesReceipt(root,receipt);
 assert.deepEqual(software,{source:path.join(root,'source'),environment:path.join(root,'environment-deadbeef'),runtimeRoot:path.join(root,'tools'),python:path.join(root,'tools',manifest.tools.python.directory,'bin/python3.14')});assert.deepEqual(receipt,original);
});
test('existing explicit software bindings remain readable without a named profile',async()=>{
 const software={source:'/synthetic/source',environment:'/synthetic/environment',runtimeRoot:'/synthetic/runtime',python:'/synthetic/python'};
 assert.deepEqual(await softwareFromHermesReceipt('/synthetic/instance',{componentId:'hermes',installed:true,software}),software);
});
test('incomplete, wrong-component and unsafe relative layouts cannot become candidates',async()=>{
 for(const receipt of [{componentId:'hermes',installed:false,environment:'environment-ab'},{componentId:'other',installed:true,environment:'environment-ab'},{componentId:'hermes',installed:true,environment:'../../escape'},{componentId:'hermes',installed:true,software:{source:'relative'}}])await assert.rejects(softwareFromHermesReceipt('/synthetic/instance',receipt));
});
