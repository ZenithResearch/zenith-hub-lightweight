import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectLegacyMatrix,applyLegacyMatrix} from '../../scripts/setup/matrix-reconcile.mjs';
import {digest} from '../../src/lib/setup/catalog.mjs';
async function fixture(t){
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'matrix-legacy-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const root=path.join(home,'instances/matrix-test');for(const d of ['config','wheels','data'])await fs.mkdir(path.join(root,d),{recursive:true,mode:0o700});await fs.mkdir(path.join(home,'plans'),{mode:0o700});
 const config={serverName:'legacy.invalid',port:19408,access:'private',federation:false,identityAcknowledged:true},plan={root,instanceId:'matrix-test',componentId:'matrix',mode:'install',digest:'old-installation-digest',config,artifacts:[{path:'/reviewed-cache/matrix.whl',sha256:digest('known wheel')}]},planFile=path.join(home,'plans/install.json');
 const json=async(file,v)=>fs.writeFile(file,JSON.stringify(v),{mode:0o600});
 await json(planFile,plan);await fs.writeFile(path.join(root,'controller.py'),'known controller',{mode:0o600});await fs.writeFile(path.join(root,'wheels/matrix.whl'),'known wheel',{mode:0o600});
 await json(path.join(root,'receipt.json'),{root,instanceId:'matrix-test',componentId:'matrix',planDigest:plan.digest,installed:true,configured:false,controllerSha256:digest('known controller'),artifacts:[{filename:'matrix.whl',sha256:digest('known wheel')}]});
 await fs.writeFile(path.join(root,'config/homeserver.yaml'),'retained private configuration',{mode:0o600});await fs.writeFile(path.join(root,'config/legacy.signing.key'),'retained identity',{mode:0o600});await fs.writeFile(path.join(root,'data/homeserver.db'),'retained accounts',{mode:0o600});
 const fields={serverName:config.serverName,signingKeyPath:path.join(root,'config/legacy.signing.key'),databaseKind:'sqlite3',databasePath:path.join(root,'data/homeserver.db'),mediaPath:path.join(root,'data/media')};
 return {root,planFile,options:{assertStopped:async()=>{},run:async()=>JSON.stringify(fields)},fields,json};
}
test('explicit legacy review/apply adds identity metadata without changing key, YAML or database',async t=>{
 const f=await fixture(t),names=['config/homeserver.yaml','config/legacy.signing.key','data/homeserver.db'],before=await Promise.all(names.map(n=>fs.readFile(path.join(f.root,n))));
 const review=await inspectLegacyMatrix(f.planFile,f.options);await assert.rejects(fs.access(path.join(f.root,'config/matrix-identity.json')));
 assert.equal((await applyLegacyMatrix(review,f.options)).nativeDataChanged,false);
 for(let i=0;i<names.length;i++)assert.deepEqual(await fs.readFile(path.join(f.root,names[i])),before[i]);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'config/matrix-identity.json'))).serverName,'legacy.invalid');
});
test('changed retained files invalidate a legacy ownership review',async t=>{
 const f=await fixture(t),review=await inspectLegacyMatrix(f.planFile,f.options);await fs.writeFile(path.join(f.root,'config/homeserver.yaml'),'changed',{mode:0o600});
 await assert.rejects(applyLegacyMatrix(review,f.options),{code:'matrix_reconciliation_review_changed'});await assert.rejects(fs.access(path.join(f.root,'config/matrix-identity.json')));
});
test('unknown original provenance or foreign signing material cannot create an identity intent',async t=>{
 const f=await fixture(t);f.fields.signingKeyPath=path.join(path.dirname(f.root),'outside.key');await fs.writeFile(f.fields.signingKeyPath,'foreign',{mode:0o600});
 await assert.rejects(inspectLegacyMatrix(f.planFile,f.options),{code:'matrix_reconciliation_key_outside_instance'});
 f.fields.signingKeyPath=path.join(f.root,'config/legacy.signing.key');const receiptFile=path.join(f.root,'receipt.json'),receipt=JSON.parse(await fs.readFile(receiptFile));receipt.planDigest='unknown';await f.json(receiptFile,receipt);
 await assert.rejects(inspectLegacyMatrix(f.planFile,f.options),{code:'matrix_original_installation_review_required'});
});

test('legacy reconciliation cannot race an existing configuration writer',async t=>{
 const f=await fixture(t),review=await inspectLegacyMatrix(f.planFile,f.options),lock=path.join(f.root,'config/configuration-lock.json');
 await f.json(lock,{retained:'writer'});
 await assert.rejects(applyLegacyMatrix(review,f.options),{code:'matrix_reconciliation_configuration_locked'});
 assert.deepEqual(JSON.parse(await fs.readFile(lock)),{retained:'writer'});
 await assert.rejects(fs.access(path.join(f.root,'config/matrix-identity.json')));
});
