import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function exerciseExample({evaluate,navigate,until,root,restart,capture}) {
  const destination = path.join(root,'local-process-example');
  const evidence = {};
  const click = async (label) => until(label,()=>evaluate(`(() => {
    const el=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled);
    if(!el)return false; el.click();return true;
  })()`),120000);
  const body = ()=>evaluate('document.body?.innerText || ""');
  async function waitFor(label, timeout=90000) {
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
    },120000);
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
      window.fetch=original;window.exampleLostResponse=true;throw Error('Injected lost browser response');
    }
    return result;
  };return true;})()`);
  await click('Run example');
  await until('lost browser response',()=>evaluate('window.exampleLostResponse === true'),120000);
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
  await waitFor('Receipt verified.');
  const history=await evaluate(`fetch('/api/hub/history?service=Local%20process%20example').then(r=>r.json())`);
  assert.ok(history.events.some(e=>!e.reason && e.step==='Verify Case, Frank effect and Runtime receipt'));
  evidence.monitor=history.events[0];
  return evidence;
}
