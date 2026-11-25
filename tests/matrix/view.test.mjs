import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {conversationSnapshot} from '../../src/lib/hub/conversation-view.mjs';
import {verifyNativeFile} from '../../src/lib/matrix/native-runtime.mjs';
const target={instanceId:'matrix-one',roomId:'!room:x',userId:'@alice:x',deviceId:'HUB'};
const view=()=>({schema:'zenith.hub-matrix-conversation.v1',...target,binding:'a'.repeat(64),encrypted:true,canSend:true,cryptoError:null,observedAt:new Date().toISOString(),messages:[{id:'$one',sender:'@alice:x',mine:true,at:1,body:'Fixture text',kind:'text'}]});
test('conversation responses cannot cross the selected room, account, device or instance',()=>{
 for(const field of ['instanceId','roomId','userId','deviceId'])assert.throws(()=>conversationSnapshot({...view(),[field]:'different'},target),{code:'matrix_chat_account_changed'});
 assert.equal(conversationSnapshot(view(),target).messages[0].body,'Fixture text');
});
test('invalid event timestamps and response shapes are not rendered, duplicate IDs are collapsed',()=>{
 for(const change of [v=>v.messages[0].at=Infinity,v=>v.messages[0].at=1e20,v=>v.messages[0].body={},v=>v.observedAt='invalid',v=>v.binding='wrong']){const v=view();change(v);assert.throws(()=>conversationSnapshot(v,target));}
 const v=view();v.messages.push({...v.messages[0]});assert.equal(conversationSnapshot(v,target).messages.length,1);
});
test('native runtime verification rejects changed bytes without loading the library',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'matrix-native-pin-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'fixture.node'),bytes=Buffer.from('fixture-only');await fs.writeFile(file,bytes);const entry={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};await verifyNativeFile(file,entry);await fs.writeFile(file,'changed');await assert.rejects(verifyNativeFile(file,entry),{code:'matrix_chat_native_changed'});
});
