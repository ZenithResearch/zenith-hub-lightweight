"use client";

import {useCallback, useEffect, useState} from 'react';
import {ResourceCanvas} from '@/vendor/zenith-ui/YourHub/YourHub';

type Action = {id:string; caseId:string; stage:string; runId?:string; error?:string;
  timeline:{stage:string; at:number}[];
  result?:{output:{text:string}; receiptId:string; actorId:string; handoffId:string; projection:string}};
type Workspace = {installed:boolean; actions:Action[]};
type Review = {id:string; source:string; destination:string; bytes:number; offline:boolean; bundleSha256:string;
  components:Record<string,{version:string;source_commit:string}>};

export default function ExamplePage() {
  const [token,setToken] = useState('');
  const [state,setState] = useState<Workspace>();
  const [plan,setPlan] = useState<Review>();
  const [busy,setBusy] = useState(false);
  const [verified,setVerified] = useState('');
  const [error,setError] = useState('');
  const call = useCallback(async (operation:string, key?:string) => {
    const response = await fetch('/api/hub', {method:'POST', cache:'no-store',
      headers:{'content-type':'application/json','x-zenith-csrf':token},
      body:JSON.stringify({schema:'zenith.hub-action.v1',operation:'example-'+operation,...(key ? {key} : {})})});
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'Hub could not complete the operation');
    return body;
  }, [token]);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/hub',{cache:'no-store',signal:abort.signal}).then(r=>r.json()).then(v=>{
      if (!v.csrf) throw Error('Local Hub is unavailable');
      setToken(v.csrf);
    }).catch(e=>{if (!abort.signal.aborted) setError(e.message);});
    return ()=>abort.abort();
  }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const refresh = () => call('status').then(v=>{if(active) setState(v);}).catch(e=>{if(active) setError(e.message);});
    void refresh();
    const timer = setInterval(refresh, 2500);
    return ()=>{active=false;clearInterval(timer);};
  }, [token,call]);
  async function act(op:string,key?:string) {
    setBusy(true);setError('');
    try {
      const value = await call(op,key);
      if (op === 'review') setPlan(value);
      else if (op === 'verify') setVerified(value.receiptId);
      else {setState(value);setPlan(undefined);}
    } catch(e) {setError(e instanceof Error ? e.message : 'Operation failed');}
    finally {setBusy(false);}
  }
  const current = state?.actions[0];
  return <ResourceCanvas paused><main id="hub-main">
    <a href="/settings">← Settings</a>
    <h1>Local process example</h1>
    <p>Service Management creates a Case, Process Runtime starts its run, and Frank uppercases “hello hub”. The example uses private databases and development authority on this Mac.</p>
    {error && <p role="alert">{error}</p>}
    {!state && !error && <p role="status">Reading the example workspace…</p>}
    {state && !state.installed && !plan && <button disabled={busy} onClick={()=>act('review')}>Review setup</button>}
    {plan && !state?.installed && <section><h2>Review local installation</h2>
      <ul>{Object.entries(plan.components).map(([k,v])=><li key={k}>{k} {v.version} · <code>{v.source_commit.slice(0,12)}</code></li>)}</ul>
      <p>{plan.offline?'Offline bundle':'Download'} · {plan.source}</p>
      <p>Archive size {plan.bytes.toLocaleString()} bytes. Bundle SHA-256 <code>{plan.bundleSha256}</code></p>
      <p>Destination <code>{plan.destination}</code></p>
      <button disabled={busy} onClick={()=>act('apply',plan.id)}>Apply</button>{' '}
      <button disabled={busy} onClick={()=>setPlan(undefined)}>Cancel</button>
    </section>}
    {busy && <p role="status">{plan ? 'Preparing the reviewed example…' : 'Waiting for the local operation…'}</p>}
    {current && <button disabled={busy} onClick={()=>act(current.result?'new':'run',current.id)}>
      {current.result?'Run new example':current.stage==='Ready'?'Run example':'Retry example'}</button>}
    {state?.actions.map(a=><section key={a.id}><h2>{a.stage}</h2><p>Action <code>{a.id}</code></p>
      {a.error && <p role="alert">{a.error}</p>}
      {a.runId && <p>Case <code>{a.caseId}</code> · Run <code>{a.runId}</code></p>}
      {a.result && <><p>Frank actor <code>{a.result.actorId}</code> · Service projection {a.result.projection}</p>
        <p>Committed output <output>{JSON.stringify(a.result.output)}</output></p>
        <p>Handoff <code>{a.result.handoffId}</code> · Runtime receipt <code>{a.result.receiptId}</code></p>
        <button disabled={busy} onClick={()=>act('verify',a.id)}>Verify receipt</button>
        {verified===a.result.receiptId && <p role="status">Receipt verified. <a href="/settings/history">Monitoring history</a></p>}</>}
      {!!a.timeline.length && <details><summary>Step history</summary><ol>{a.timeline.map((v,i)=><li key={i}>{new Date(v.at*1000).toLocaleTimeString()} · {v.stage}</li>)}</ol></details>}
    </section>)}
  </main></ResourceCanvas>;
}
