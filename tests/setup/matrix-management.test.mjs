import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifyMatrixListener} from '../../src/lib/setup/matrix-management.mjs';
async function fixture(t,{foreignListener=false,reusedPid=false}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'matrix-management-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'process.json'),JSON.stringify({pid:1234,childPid:1235,started:'fixture process birth'}),{mode:0o600});
 const calls=[],run=async(exe,args)=>{calls.push({exe,args});if(exe.endsWith('lsof'))return foreignListener?'9999\n':'1235\n';if(args.includes('lstart='))return reusedPid?'different birth':'fixture process birth';return args.includes('1234')?'python '+root+'/controller.py _serve --plan private':root+'/venv/bin/python -I -m synapse.app.homeserver --config-path '+root+'/config/homeserver.yaml';};
 return {instance:{root,config:{port:19408}},run,calls};
}
test('local bootstrap authority requires the exact owned wrapper, child and listening port',async t=>{
 const f=await fixture(t);assert.equal((await verifyMatrixListener(f.instance,{run:f.run})).pid,1235);assert.ok(f.calls.some(c=>c.exe==='/usr/sbin/lsof'&&c.args.includes('-iTCP:19408')));
});
test('a reachable foreign listener or reused process marker cannot grant management authority',async t=>{
 for(const flags of [{foreignListener:true},{reusedPid:true}]){const f=await fixture(t,flags);await assert.rejects(verifyMatrixListener(f.instance,{run:f.run}),{code:'matrix_local_listener_unverified'});}
});
