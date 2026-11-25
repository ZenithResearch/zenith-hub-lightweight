import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {generateKeyPairSync} from 'node:crypto';
import path from 'node:path';
import {createServer} from 'node:net';
import {mkdtemp, realpath, mkdir, copyFile, chmod, readFile, writeFile, stat, rm, readdir} from 'node:fs/promises';
import {createHubController} from '../../src/lib/hub/controller.mjs';
import {createSetupController} from '../../src/lib/setup/controller.mjs';
import {emptySetup, emptyResources} from '../../src/lib/application/model.mjs';
import {HubApplication} from '../../src/lib/application/database.mjs';
import {closeApplication} from '../../src/lib/application/owner.mjs';
import {stateStore, atomic} from '../../src/lib/setup/state.mjs';
import {digest} from '../../src/lib/setup/catalog.mjs';

const release = JSON.parse(await readFile('profiles/setup/process-runtime-upgrade.json','utf8'));
const base = process.env.RUNTIME_TEST_BASE_WHEELS;
const candidate = process.env.RUNTIME_TEST_CANDIDATE_WHEELS;
const dependencies = process.env.RUNTIME_TEST_DEPENDENCY_WHEELS;

test('Settings reviews, stages, activates and rolls back the pinned Runtime while preserving its database',
  {skip:!base || !candidate || !dependencies ? 'Requires the offline macOS Runtime wheel closures' : false}, async t => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-runtime-rehearsal-')));
    const id='runtime-rehearsal', instance=path.join(root,'instances',id);
    const cache=path.join(root,'cache/runtime-upgrades',release.commit);
    await mkdir(cache,{recursive:true,mode:0o700});
    for (const wheel of release.wheels) {
      const dir=wheel.filename.startsWith('process_runtime-') ? candidate : dependencies;
      await copyFile(path.join(dir,wheel.filename),path.join(cache,wheel.filename));
    }
    const listener=createServer();
    await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    const port=listener.address().port;
    await new Promise(resolve=>listener.close(resolve));
    const origin='http://127.0.0.1:4318';
    const env={ZENITH_LOCAL_OPERATOR:'1',ZENITH_GUIDED_SETUP:'1',ZENITH_OPERATOR_ORIGIN:origin,
      ZENITH_HUB_SETUP_DIR:root,ZENITH_SETUP_BASE_WHEELHOUSE:base};
    if(process.env.RUNTIME_TEST_APPLICATION_DB === '1') {
      const dataDir=path.join(root,'objects'), resourcesFile=path.join(root,'resources.json');
      const app=await HubApplication.open({setupRoot:root,dataDir,resourcesFile});
      try {
        await app.initialize({setup:emptySetup(),resources:emptyResources()});
        const {repositoryId,definitionSetId}=await app.status();
        await atomic(path.join(root,'application.json'),{schema:'zenith.hub-application-activation.v1',
          setupRoot:root,dataDir,resourcesFile,repositoryId,definitionSetId});
      } finally {await app.close();}
    }
    const setup=createSetupController({env,projector:async()=>{}});
    const hub=createHubController({env,setup,connections:{snapshot:async()=>({mode:'disabled'})}});
    const req=token=>new Request(origin+'/api/hub',{headers:{host:'127.0.0.1:4318',origin,
      'content-type':'application/json',...(token?{'x-zenith-csrf':token}:{})}});
    const initial=await hub.get(req());
    const post=body=>hub.post(req(initial.csrf),{schema:'zenith.hub-action.v1',...body});
    const review=async action=>(await post({operation:'plan-control',resourceKey:'setup:'+id,action})).plan;
    const apply=async plan=>post({operation:'apply',planId:plan.id});
    const act=async action=>apply(await review(action));
    const receipt=async()=>JSON.parse(await readFile(path.join(instance,'receipt.json')));
    const start=async()=>{
      await act('start');
      for(let i=0;i<60;i++){
        try {const r=await fetch('http://127.0.0.1:'+port+'/ready');return {status:r.status,body:await r.json()};}
        catch{await new Promise(resolve=>setTimeout(resolve,100));}
      }
      throw Error('Runtime did not start');
    };
    t.after(async()=>{try{await act('stop');}catch{} finally{await closeApplication(root);await rm(root,{recursive:true,force:true});}});
    const install=await post({operation:'plan-add',componentId:'process-runtime',instanceId:id,mode:'install',
      config:{port},expectedRevision:initial.setupRevision});
    await apply(install.plan);
    await act('configure');
    assert.equal((await start()).status,503);
    assert.ok((await review('upgrade-runtime')).items[0].prerequisites.some(p=>p.includes('Stop this Runtime')));
    await act('stop');
    const before=await receipt(),db=path.join(instance,'data/runtime.db');
    const baselineDb=await stat(db), baselineHash=digest(await readFile(db));
    const admission=path.join(instance,'config/admission.json');
    await writeFile(admission,JSON.stringify({enabled:true}),{mode:0o600});
    const incomplete=await review('upgrade-runtime');
    assert.ok(incomplete.items[0].prerequisites.some(s=>s.includes('together')));
    assert.ok(incomplete.items[0].prerequisites.some(s=>s.includes('Close new-run')));
    await rm(admission);
    const verifier = process.env.RUNTIME_TEST_NATIVE_VERIFIER;
    if (verifier) {
      const config=path.join(instance,'config'), helper=path.join(config,'secs-verifier');
      await copyFile(verifier,helper);
      await chmod(helper,0o700);
      const audience='runtime://isolated-rehearsal', policy=path.join(config,'policy.json');
      await atomic(policy,{schema:'runtime.receiver-policy.v1',audience,keys:[],descriptors:[],permissions:[],revoked_subject_keys:[]});
      await atomic(path.join(config,'receiver.json'),{schema:'runtime.receiver-configuration.v1',audience,
        native_verifier:{executable:helper,sha256:release.verifierSha256},policy_file:policy});
      await atomic(admission,{schema:'runtime.new-run-admission.v1',enabled:false,composition_digest:'e'.repeat(64)});
      const publicKey=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32);
      await atomic(path.join(config,'readiness-trust.json'),{schema:'runtime.readiness-trust.v1',
        public_key_hex:publicKey.toString('hex'),receipt_file:path.join(config,'qualification.json')});
    }
    const wheel=path.join(cache,release.wheels[0].filename);
    const bytes=await readFile(wheel);
    await writeFile(wheel,'corrupt');
    assert.ok((await review('upgrade-runtime')).items[0].prerequisites.length);
    await writeFile(wheel,bytes);
    const proposal=await review('upgrade-runtime');
    assert.equal(proposal.items[0].source.commit,release.commit);
    assert.deepEqual(proposal.items[0].prerequisites,[]);
    assert.ok(proposal.items[0].effects.join(' ').includes(release.baseCommit));
    await writeFile(wheel,'changed-after-review');
    await assert.rejects(apply(proposal));
    assert.deepEqual(await receipt(),before);
    assert.equal(digest(await readFile(db)),baselineHash);
    await post({operation:'reconcile-setup'});
    await writeFile(wheel,bytes);
    const retry=await review('upgrade-runtime');
    await apply(retry);
    assert.equal((await receipt()).runtimeRelease.commit,release.commit);
    // Simulate interruption after the atomic receipt switch and before Hub completion.
    await stateStore(root).write(s=>{s.operations[retry.id].state='applying';});
    await post({operation:'reconcile-setup'});
    assert.equal((await stateStore(root).read()).operations[retry.id].state,'complete');
    assert.equal(digest(await readFile(db)),baselineHash);
    const health=await start();
    assert.equal(health.status,503);
    assert.equal(health.body.checks.authority,verifier?'configured_native_unqualified':'default_deny');
    if (verifier) assert.equal(health.body.checks.verification,'available');
    assert.equal(health.body.checks.admission.new_runs,'closed');
    await act('stop');
    const back=await review('rollback-runtime');
    assert.equal(back.items[0].source.commit,release.baseCommit);
    await apply(back);
    const after=await receipt();
    assert.deepEqual(after.artifacts,before.artifacts);
    assert.equal(after.copyId,before.copyId);
    assert.equal(after.runtimeRelease,undefined);
    assert.equal((await stat(db)).ino,baselineDb.ino);
    assert.equal((await start()).status,503);
    await act('stop');
    const stored=await stateStore(root).read();
    assert.equal(stored.instances.find(i=>i.instanceId===id).source.commit,release.baseCommit);
    assert.equal((await readdir(path.join(root,'backups',id))).filter(f=>f.endsWith('.tar.gz')).length,2);
});
