import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function exerciseExample({evaluate,navigate,until,root,restart,capture}) {
  const destination = path.join(root,'local-process-example');
  const evidence = {};
  // The owner workflow allows 150 seconds to start its services and verify the receipt.
  const ownerTimeout = 165000;
  const click = async (label) => until(label,()=>evaluate(`(() => {
    const el=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled);
    if(!el)return false; el.click();return true;
  })()`),120000);
  const body = ()=>evaluate('document.body?.innerText || ""');
  async function waitFor(label, timeout=ownerTimeout) {
    await until(label,async()=>{
      const text = await body();
      if(text.includes(label)) return true;
      const error=await evaluate('document.querySelector(\'[role="alert"]\')?.textContent');
      if(error) throw Error(error);
    },timeout);
  }
  async function results(n) {
    await until(n+' committed example outputs',async()=>{
      const outputs=await evaluate('[...document.querySelectorAll("output")].map(e=>e.textContent)');
      if(outputs?.length===n){assert.ok(outputs.every(v=>v==='{"text":"HELLO HUB"}'));return true;}
      const error=await evaluate('document.querySelector(\'[role="alert"]\')?.textContent');
      if(error)throw Error(error);
    },ownerTimeout);
  }
  await click('Set up local process example');
  await click('Review setup');
  await waitFor('Review local installation');
  evidence.review=await body();
  await capture('review');
  await click('Apply');
  await waitFor('Run example',240000);
  // Lose the acknowledgement at the browser boundary after the server has accepted the command.
  await evaluate(`(() => {const original=window.fetch;window.fetch=async(...args)=>{
    const result=await original(...args);
    if(JSON.parse(args[1]?.body || '{}').operation==='example-run' && result.ok){
      window.fetch=original;
      const replay=await original(...args);
      if(!replay.ok)throw Error('Exact run retry failed');
      window.exampleLostResponse=true;throw Error('Injected lost browser response');
    }
    return result;
  };return true;})()`);
  await click('Run example');
  await until('lost browser response',()=>evaluate('window.exampleLostResponse === true'),ownerTimeout);
  const state=()=>fs.readFile(path.join(destination,'workspace.json'),'utf8').then(JSON.parse);
  const first=(await state()).actions[0];
  const exampleUrl=await evaluate('location.href');
  await restart();
  await navigate(exampleUrl);
  await results(1);
  assert.deepEqual((await state()).actions,[first]);
  const before=await fs.readFile(path.join(destination,'action-'+first+'.json'),'utf8');
  await click('Verify receipt');
  await waitFor('Receipt verified.');
  assert.equal(await fs.readFile(path.join(destination,'action-'+first+'.json'),'utf8'),before);
  evidence.first=JSON.parse(before).result;
  await evaluate(`(() => {const original=window.fetch; window.fetch=async(...args)=>{
    const first=await original(...args);
    if(JSON.parse(args[1]?.body || '{}').operation==='example-new' && first.ok){
      window.fetch=original;return original(...args);
    }
    return first;
  };return true;})()`);
  await click('Run new example');
  await results(2);
  const ids=(await state()).actions;
  assert.equal(ids.length,2);assert.equal(ids[0],first);assert.notEqual(ids[1],first);
  const second=JSON.parse(await fs.readFile(path.join(destination,'action-'+ids[1]+'.json'),'utf8'));
  assert.notEqual(second.caseId,JSON.parse(before).caseId);
  assert.notEqual(second.runId,JSON.parse(before).runId);
  evidence.actions=ids;
  evidence.second=second.result;
  await capture('completed');
  await click('Verify receipt');
  await until('both receipt checks in monitor history', async()=>{
    const h=await evaluate(`fetch('/api/hub/history?service=Local%20process%20example').then(r=>r.json())`);
    return h.events.filter(e=>!e.reason).length===2;
  },ownerTimeout);
  const history=await evaluate(`fetch('/api/hub/history?service=Local%20process%20example').then(r=>r.json())`);
  assert.ok(history.events.some(e=>!e.reason && e.step==='Verify Case, Frank effect and Runtime receipt'));
  evidence.monitor=history.events[0];
  for (const field of ["at","cpu","memoryUsed","diskUsed"]) assert.ok(Number.isFinite(evidence.monitor[field]));
  return evidence;
}
