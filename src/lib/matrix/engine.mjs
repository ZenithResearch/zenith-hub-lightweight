/** Supervise a private crypto worker; enforce the Hub transport boundary in the parent. */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {allowedSdkRequest} from './sdk-engine.mjs';
import {requestJSON} from '../setup/network.mjs';
import {check} from '../setup/catalog.mjs';
export async function createChatEngine({directory,endpoint,session,request=requestJSON,allowPrivateHosts=[]}){
 // Keep the explicitly traced worker as raw Node source; Turbopack must not bundle the native process entry.
 const child=spawn(process.execPath,[path.join(process.cwd(),'src/lib/matrix/worker.mjs')],{stdio:['ignore','ignore','ignore','ipc'],serialization:'json'}),pending=new Map();let sequence=0,closed=false;
 // Idle crypto must not keep a stopped Next server alive. Pending RPC deadlines keep commands alive until completion.
 child.unref();
 const failure=code=>Object.assign(Error(code),{code,status:409});
 const rejectAll=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(failure('matrix_chat_crypto_unavailable'));}pending.clear();};
 child.on('exit',rejectAll);child.on('error',rejectAll);
 child.on('message',async message=>{
  if(message.kind==='result'){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);if(!pending.size)child.channel?.unref();message.error?p.reject(failure(message.error)):p.resolve(message.value);}
  else if(message.kind==='request'){
   try{check(message,message.endpoint===endpoint&&allowedSdkRequest(message.options?.method,message.route)&&typeof message.route==='string'&&message.route.length<=16384,'matrix_chat_sdk_action_denied');
    const value=await request(endpoint,message.route,{method:message.options.method,body:message.options.body,token:session.token,timeout:8000,allowPrivateHosts});if(child.connected)child.send({kind:'response',id:message.id,value});
   }catch(e){if(child.connected)child.send({kind:'response',id:message.id,error:e.code?.startsWith('matrix_chat_')?e.code:'matrix_chat_unavailable'});}
  }
 });
 const run=(operation,args={})=>new Promise((resolve,reject)=>{
  if(closed){reject(failure('matrix_chat_crypto_unavailable'));return;}
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(failure('matrix_chat_crypto_unavailable'));child.kill('SIGTERM');},60000);pending.set(id,{resolve,reject,timer});child.channel?.ref();child.send({kind:'command',id,operation,args});
 });
 try{await run('init',{directory,endpoint,session});}catch(e){child.kill('SIGTERM');throw e;}
 return {get closed(){return closed;},sync:()=>run('sync'),decrypt:(event,roomId)=>run('decrypt',{event,roomId}),encrypt:(roomId,body)=>run('encrypt',{roomId,body}),async close(){if(closed)return;child.ref();await run('close');await new Promise(resolve=>{if(closed)resolve();else child.once('exit',resolve);});}};
}
