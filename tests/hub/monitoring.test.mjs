import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {probe} from '../../src/lib/setup/network.mjs';
import {serviceMonitor,readHistory} from '../../src/lib/hub/monitoring.mjs';

test('real readiness failures persist with host samples and are independent of subsequent recovery',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-checks-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let ready=false;
  const server=createServer((req,res)=>{
    res.writeHead(req.url==='/ready'&&!ready?503:200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ready,detail:'body-must-stay-private'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const monitor=serviceMonitor({ZENITH_HUB_SETUP_DIR:root,ZENITH_LOCAL_OPERATOR:'1'},'setup:runtime-a');
  const addr='http://127.0.0.1:'+server.address().port;
  assert.equal((await probe('process-runtime',addr,{monitor})).applicationReady,false);
  ready=true;
  assert.equal((await probe('process-runtime',addr,{monitor})).applicationReady,true);
  const {events}=await readHistory(root,{service:'setup:runtime-a',failures:true});
  assert.equal(events.length,1);
  const [event]=events;
  assert.equal(event.step,'Readiness');assert.equal(event.reason,'HTTP 503');
  assert.ok(event.cpu>=0&&event.cpu<=100&&event.cpu!==null);
  assert.ok(event.memoryUsed>0&&event.diskTotal>=event.diskUsed&&event.diskUsed>0);
  const all=await readHistory(root);
  assert.equal(all.events.length,4);assert.ok(!JSON.stringify(all).includes('body-must-stay-private'));
  const file=path.join(root,'monitoring/checks.sqlite');
  assert.equal((await stat(file)).mode&0o077,0);
  const module=new URL('../../src/lib/hub/monitoring.mjs',import.meta.url).href;
  const reopened=execFileSync(process.execPath,['--input-type=module','-e',
    'import {readHistory} from '+JSON.stringify(module)+'; console.log((await readHistory(process.argv[1])).events.length)',root],{encoding:'utf8'});
  assert.equal(reopened.trim(),'4');
  const db=new DatabaseSync(file);
  try{
    const insert=db.prepare("INSERT INTO checks(at,service,step,duration) VALUES (?,'setup:other','Health',1)");
    insert.run(Date.now()-8*86400000);
    for(let i=0;i<45;i++)insert.run(Date.now());
    const first=await readHistory(root), next=await readHistory(root,{before:first.older});
    assert.equal(first.events.length,40);assert.equal(next.events.length,9);
    assert.ok(next.events.every(e=>e.id<first.older));
    assert.equal(db.prepare('SELECT count(*) AS n FROM checks WHERE at<?').get(Date.now()-7*86400000).n,0);
  }finally{db.close();}
});
