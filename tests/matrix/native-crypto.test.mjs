import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture} from './fixture.mjs';
import {createChatEngine} from '../../src/lib/matrix/engine.mjs';
test('native Megolm encrypt/decrypt survives worker and persistent-store reopen',async t=>{
 const f=await fixture(t,{encrypted:true}),directory=path.join(f.root,'credentials','native-crypto');let engine;
 try{
  engine=await createChatEngine({directory,endpoint:f.base,session:f.session});await engine.sync();
  const body='Native fixture message — never sent to a live homeserver',content=await engine.encrypt(f.roomId,body);
  assert.equal(content.algorithm,'m.megolm.v1.aes-sha2');assert.equal(typeof content.ciphertext,'string');assert.doesNotMatch(JSON.stringify(content),/Native fixture message/);
  const event={event_id:'$native-fixture',origin_server_ts:Date.now(),room_id:f.roomId,type:'m.room.encrypted',sender:f.userId,content};
  const clear=await engine.decrypt(event,f.roomId);assert.equal(clear.content.body,body);
  const first=JSON.parse(await fs.readFile(path.join(directory,'identity.json'),'utf8'));await engine.close();
  engine=await createChatEngine({directory,endpoint:f.base,session:f.session});await engine.sync();
  assert.equal((await engine.decrypt(event,f.roomId)).content.body,body);
  const second=JSON.parse(await fs.readFile(path.join(directory,'identity.json'),'utf8'));assert.equal(second.ed25519,first.ed25519);
  await assert.rejects(createChatEngine({directory,endpoint:f.base,session:f.session}),{code:'matrix_chat_crypto_in_use'});
  await engine.close();
  const sqlite=path.join(directory,'crypto',createHash('sha256').update(f.session.deviceId).digest('hex'),'matrix-sdk-crypto.sqlite3');
  await fs.rename(sqlite,sqlite+'.held');const uploads=f.state.uploads;
  await assert.rejects(createChatEngine({directory,endpoint:f.base,session:f.session}),{code:'matrix_chat_crypto_store_missing'});assert.equal(f.state.uploads,uploads);
  assert.equal(f.state.sends.length,0);assert.equal((await fs.stat(directory)).mode&0o077,0);
 }finally{await engine?.close();}
});

test('an idle crypto worker cannot keep its owning Hub process alive',async t=>{
 const f=await fixture(t,{encrypted:true}),directory=path.join(f.root,'credentials','idle-lifecycle');
 const module=new URL('../../src/lib/matrix/engine.mjs',import.meta.url).href;
 const code=`const {createChatEngine}=await import(${JSON.stringify(module)});await createChatEngine(${JSON.stringify({directory,endpoint:f.base,session:f.session})});console.log('crypto-ready');`;
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),timeout:15000});
 assert.match(result.stdout,/crypto-ready/);assert.equal(f.state.sends.length,0);
});
