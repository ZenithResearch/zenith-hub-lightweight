/** Product HTTP qualification against a disposable Matrix protocol fixture. No existing homeserver is contacted. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {matrixFixture} from '../tests/setup/matrix-fixture.mjs';
const cleanup=[],remote=await matrixFixture({after:fn=>cleanup.push(fn)}),repo=process.cwd(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hub-matrix-http-')));await fs.chmod(root,0o700);
const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
const standalone=process.argv.includes('--standalone');
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('ZENITH_'))),HOME:root,NEXT_TELEMETRY_DISABLED:'1',ZENITH_OPERATOR_ORIGIN:origin,PORT:String(port),HOSTNAME:'127.0.0.1',ZENITH_LOCAL_OPERATOR:'1',ZENITH_GUIDED_SETUP:'1',ZENITH_HUB_CATALOG_READY:'1',ZENITH_HUB_APPLICATION_DB:'1',ZENITH_HUB_REPOSITORY_FOUNDATION:'1',ZENITH_OPERATOR_PORT:String(port),ZENITH_HUB_SETUP_DIR:root,ZENITH_HUB_DATA_DIR:path.join(root,'objects'),ZENITH_HUB_RESOURCES_FILE:path.join(root,'resources.json')};
if(standalone){const prepared=spawnSync(process.execPath,['scripts/hub.mjs','prepare','--setup-dir',root],{cwd:repo,env,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);}
let child,output='';
async function start(){
 output='';child=spawn(process.execPath,standalone?['server.js']:['scripts/hub.mjs','serve',process.argv.includes('--dev')?'--dev':'--production','--setup-dir',root,'--port',String(port)],{cwd:standalone?path.join(repo,'.next/standalone'):repo,env,stdio:['ignore','pipe','pipe'],detached:true});
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>output=(output+b).slice(-8000));
 for(let n=0;n<100;n++){try{return await get('/api/database');}catch(e){if(child.exitCode!==null)throw Error('Hub startup failed: '+output);if(n===99)throw e;await new Promise(r=>setTimeout(r,300));}}
}
async function stop(){if(!child)return;const c=child;child=null;try{process.kill(-c.pid,'SIGTERM');}catch{}await new Promise(resolve=>{if(c.exitCode!==null)return resolve();const timer=setTimeout(()=>{try{process.kill(-c.pid,'SIGKILL');}catch{}resolve();},5000);c.once('exit',()=>{clearTimeout(timer);resolve();});});}
async function get(route){const r=await fetch(origin+route,{signal:AbortSignal.timeout(45000)}),v=await r.json();assert.equal(r.status,200,route+':'+JSON.stringify(v));return v;}
async function post(route,session,body,status=200){const r=await fetch(origin+route,{method:'POST',headers:{origin,'content-type':'application/json','x-zenith-csrf':session.csrf},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}),v=await r.json();assert.equal(r.status,status,route+':'+JSON.stringify(v));return v;}
const hub=(session,body,status)=>post('/api/hub',session,{schema:'zenith.hub-action.v1',...body},status);
const matrix=(session,body,status)=>post('/api/matrix',session,{schema:'zenith.hub-matrix-action.v1',...body},status);
let session;
async function action(action,args,secret){const review=await matrix(session,{operation:'review',instanceId:'matrix-fixture',action,args});const result=await matrix(session,{operation:'apply',planId:review.plan.id,...(secret?{secret}:{})});assert.equal(result.result.state,'complete',JSON.stringify(result.result));session=result;return result;}
try{
 const db=await start();assert.equal(db.ready,true);const gallery=await get('/api/hub');
 const add=await hub(gallery,{operation:'plan-add',componentId:'matrix',instanceId:'matrix-fixture',mode:'connect',config:{label:'Disposable Matrix',endpoint:remote.base+'/'},expectedRevision:gallery.setupRevision});
 await hub(gallery,{operation:'apply',planId:add.plan.id});
 for(let n=0;n<60;n++){const setup=await get('/api/setup');const op=setup.operations.find(o=>o.id===add.plan.id);if(op?.state==='reconciliation-required')throw Error('Fixture connection needs reconciliation');if(op?.state==='complete')break;await new Promise(r=>setTimeout(r,200));}
 assert.equal((await hub(await get('/api/hub'),{operation:'refresh'})).resources.find(i=>i.componentId==='matrix').status,'API available · sign in required');
 session=await get('/api/matrix');await matrix(session,{operation:'refresh',instanceId:'matrix-fixture'});
 await action('login',{method:'m.login.password',username:'reviewer'},remote.password);
 await action('select-room',{roomId:'!lobby:fixture.invalid'});
 const retained=await matrix(session,{operation:'review',instanceId:'matrix-fixture',action:'create-space',args:{name:'Disposable shared space',visibility:'private',joinRule:'invite',encryption:false}});
 await stop();await start();session=await get('/api/matrix');
 assert.equal(session.instances[0].account.userId,remote.userId);assert.equal(session.instances[0].selected.roomId,'!lobby:fixture.invalid');
 const applied=await matrix(session,{operation:'apply',planId:retained.plan.id});assert.equal(applied.result.state,'complete');session=applied;
 await action('message-test',{roomId:'!lobby:fixture.invalid',acknowledgeSend:true});
 const proof=session.instances[0].operations.find(o=>o.action==='message-test').result;assert.equal(proof.sendVerified,true);assert.equal(proof.readVerified,true);
 // The new chat capability uses the retained Hub session; all messages below go only to this disposable fixture.
 const chat=(operation,roomId,extra={})=>post('/api/matrix/conversation',session,{schema:'zenith.hub-matrix-conversation-action.v1',operation,instanceId:'matrix-fixture',roomId,...extra});
 const plain=await chat('timeline','!lobby:fixture.invalid');assert.equal(plain.canSend,true);assert.equal(plain.encrypted,false);
 const draft='Fixture conversation message',transactionId='hub_'+randomUUID();
 const sent=await chat('send',plain.roomId,{binding:plain.binding,message:draft,transactionId});
 assert.equal((await chat('send',plain.roomId,{binding:plain.binding,message:draft,transactionId})).eventId,sent.eventId);
 assert.equal((await chat('timeline',plain.roomId)).messages.find(m=>m.id===sent.eventId).body,draft);
 const encrypted=await chat('timeline','!encrypted:fixture.invalid');assert.equal(encrypted.cryptoError,null,JSON.stringify(encrypted));assert.equal(encrypted.canSend,true);assert.equal(encrypted.encrypted,true);
 const sealedText='Disposable native Megolm HTTP fixture',sealed=await chat('send',encrypted.roomId,{binding:encrypted.binding,message:sealedText,transactionId:'hub_'+randomUUID()});
 const envelope=remote.events.get(sealed.eventId);assert.equal(envelope.type,'m.room.encrypted');assert.doesNotMatch(JSON.stringify(envelope.content),/Disposable native Megolm/);
 assert.equal((await chat('timeline',encrypted.roomId)).messages.find(m=>m.id===sealed.eventId).body,sealedText);
 const keys=JSON.stringify(remote.state.deviceKeys);await stop();await start();session=await get('/api/matrix');
 assert.equal((await chat('timeline',encrypted.roomId)).messages.find(m=>m.id===sealed.eventId).body,sealedText);assert.equal(JSON.stringify(remote.state.deviceKeys),keys);
 const badChat=await fetch(origin+'/api/matrix/conversation',{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}'});assert.equal(badChat.status,403);
 const cross=await fetch(origin+'/api/matrix',{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}'});assert.equal(cross.status,403);
 const page=await fetch(origin+'/hub?matrix=matrix-fixture');assert.equal(page.status,200);
 console.log(JSON.stringify({passed:true,mode:standalone?'standalone':process.argv.includes('--dev')?'development':'production',origin,root,checks:['reviewed-save-normalized-endpoint','API-is-not-authentication','verified-account','room-selection','review-and-session-survive-server-restart','explicit-send-and-read','cross-origin-rejected','gallery-served','in-window-chat-history','idempotent-chat-send','native-encrypted-send-read','device-and-room-keys-survive-restart'],liveServerTouched:false}));
 if(process.argv.includes('--keep')){await fs.writeFile('/tmp/hub-matrix-preview.json',JSON.stringify({origin,root,pid:process.pid}),{mode:0o600});await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});}
}finally{await stop();for(const fn of cleanup)await fn();if(!process.argv.includes('--keep'))await fs.rm(root,{recursive:true,force:true});}
