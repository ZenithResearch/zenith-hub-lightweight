import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {projectMessages} from '../../src/lib/matrix/conversations.mjs';
import {sdkRoute,allowedSdkRequest} from '../../src/lib/matrix/sdk-engine.mjs';
const transactionId=()=> 'hub_'+randomUUID();
test('only the same-origin credential-bound joined account can read history',async t=>{
 const f=await fixture(t);f.state.events.push({event_id:'$one',sender:f.userId,origin_server_ts:10,type:'m.room.message',content:{body:'Fixture hello'}});
 const view=await f.timeline();assert.equal(view.messages[0].body,'Fixture hello');assert.equal(view.canSend,true);assert.doesNotMatch(JSON.stringify(view),/fixture-chat-token|credentialRef/);
 await assert.rejects(f.controller.post(f.req({origin:'https://foreign.invalid'}),{}),{code:'matrix_chat_wrong_origin'});
 f.state.whoUser='@other:fixture.invalid';await assert.rejects(f.timeline(),{code:'matrix_chat_account_changed'});
 f.state.whoUser=f.userId;f.state.member=false;await assert.rejects(f.timeline(),{code:'matrix_chat_not_joined'});
});
test('explicit send is idempotent and refuses a changed transaction body',async t=>{
 const f=await fixture(t),view=await f.timeline(),id=transactionId(),body={operation:'send',binding:view.binding,message:'User fixture message',transactionId:id};
 const first=await f.action(body),second=await f.action(body);assert.equal(first.eventId,second.eventId);assert.equal(f.state.events.length,1);assert.equal(f.state.sends.length,1);
 await assert.rejects(f.action({...body,message:'Changed'}),{code:'matrix_chat_transaction_changed'});
 f.state.canSend=false;await assert.rejects(f.action({...body,transactionId:transactionId()}),{code:'matrix_chat_permission_denied'});
});
test('unknown delivery retains the exact encrypted envelope for an explicit retry',async t=>{
 let encrypted=0;const engineFactory=async()=>({sync:async()=>{},encrypt:async()=>({algorithm:'m.megolm.v1.aes-sha2',ciphertext:'fixture-cipher-'+(++encrypted)}),decrypt:async e=>e,close:async()=>{},closed:false});
 const f=await fixture(t,{encrypted:true,engineFactory}),view=await f.timeline(),body={operation:'send',binding:view.binding,message:'Fixture private message',transactionId:transactionId()};
 f.state.dropAfterCommit=true;await assert.rejects(f.action(body),{code:'matrix_chat_send_unknown'});assert.equal(encrypted,1);
 await f.action(body);assert.equal(encrypted,1);assert.equal(f.state.events.length,1);assert.equal(f.state.sends.length,2);assert.deepEqual(f.state.sends[0].content,f.state.sends[1].content);assert.equal(f.state.sends[0].type,'m.room.encrypted');assert.doesNotMatch(JSON.stringify(f.state.sends),/Fixture private message/);
});
test('missing crypto blocks encrypted sending without a plaintext fallback',async t=>{
 const f=await fixture(t,{encrypted:true,engineFactory:async()=>{throw Object.assign(Error(),{code:'matrix_chat_crypto_store_missing'});}}),view=await f.timeline();assert.equal(view.canSend,false);assert.equal(view.cryptoError,'matrix_chat_crypto_store_missing');
 await assert.rejects(f.action({operation:'send',binding:view.binding,message:'Secret',transactionId:transactionId()}),{code:'matrix_chat_crypto_store_missing'});assert.equal(f.state.sends.length,0);
});
test('disabled, changed and expired sessions cannot use a previous conversation binding',async t=>{
 const f=await fixture(t),view=await f.timeline();await f.store.write(s=>{s.instances[0].enabled=false;});await assert.rejects(f.timeline(),{code:'matrix_chat_connection_unavailable'});
 await f.store.write(s=>{s.instances[0].enabled=true;s.instances[0].matrix.account.deviceId='CHANGED';});await assert.rejects(f.action({operation:'send',binding:view.binding,message:'No',transactionId:transactionId()}),{code:'matrix_chat_session_unavailable'});assert.equal(f.state.sends.length,0);
});
test('redactions and same-sender edits are applied while HTML remains plain text',()=>{
 const e=(id,sender,body)=>({event_id:id,sender,type:'m.room.message',origin_server_ts:10,content:{body}});
 const events=[e('$one','@a:x','Original'),{...e('$edit','@a:x','* Edited'),content:{'m.relates_to':{rel_type:'m.replace',event_id:'$one'},'m.new_content':{body:'<script>plain text</script>'}}},e('$gone','@a:x','Gone'),{type:'m.room.redaction',redacts:'$gone'}];
 events.push({...e('$forged','@other:x','* Forged'),origin_server_ts:20,content:{'m.relates_to':{rel_type:'m.replace',event_id:'$one'},'m.new_content':{body:'Forged replacement'}}});
 const result=projectMessages(events,'@a:x');assert.equal(result.length,2);assert.equal(result.find(e=>e.id==='$one').body,'<script>plain text</script>');assert.equal(result.find(e=>e.id==='$gone').body,'Message removed');
});
test('the SDK transport cannot escape the selected Matrix origin or perform room writes',()=>{
 assert.match(sdkRoute('/_matrix/client/v3/rooms/!r%3Ax/state',{}),/%21r%3Ax/);assert.equal(allowedSdkRequest('PUT','/_matrix/client/v3/rooms/!r:x/send/m.room.message/id'),false);
 assert.equal(allowedSdkRequest('POST','/_matrix/client/v3/keys/upload'),true);assert.equal(allowedSdkRequest('GET','https://foreign.invalid/_matrix/client/v3/sync'),false);assert.throws(()=>sdkRoute('https://foreign.invalid/x',{}));
});
