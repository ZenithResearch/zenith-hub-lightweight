/** One native crypto machine per worker; IPC disconnect closes it with the owning Hub. */
import {createSdkEngine} from './sdk-engine.mjs';
let engine,queue=Promise.resolve(),sequence=0;const requests=new Map();
const request=(endpoint,route,options)=>new Promise((resolve,reject)=>{const id=++sequence;requests.set(id,{resolve,reject});process.send({kind:'request',id,endpoint,route,options});});
process.on('disconnect',()=>process.exit(0));
process.on('message',message=>{
 if(message.kind==='response'){const pending=requests.get(message.id);if(!pending)return;requests.delete(message.id);message.error?pending.reject(Object.assign(Error(message.error),{code:message.error})):pending.resolve(message.value);return;}
 if(message.kind!=='command')return;
 queue=queue.then(async()=>{
  try{
   let value;if(message.operation==='init')engine=await createSdkEngine({...message.args,request});
   else if(message.operation==='close'){process.send({kind:'result',id:message.id,value:null},()=>process.exit(0));return;}
   else if(message.operation==='sync')value=await engine.sync();
   else if(message.operation==='decrypt')value=await engine.decrypt(message.args.event,message.args.roomId);
   else if(message.operation==='encrypt')value=await engine.encrypt(message.args.roomId,message.args.body);
   else throw Error('matrix_chat_invalid_operation');
   process.send({kind:'result',id:message.id,value:value??null});
  }catch(e){process.send({kind:'result',id:message.id,error:e.code?.startsWith('matrix_chat_')?e.code:'matrix_chat_crypto_unavailable'},()=>{if(message.operation==='init')process.exit(1);});}
 });
});
