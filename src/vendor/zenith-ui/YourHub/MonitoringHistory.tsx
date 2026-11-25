"use client";
import {ResourceCanvas} from './YourHub.tsx';

export type CheckEvent = {
  id:number; at:number; service:string; step:string; reason:string|null; duration:number;
  cpu:number|null; memoryUsed:number|null; memoryTotal:number|null; diskUsed:number|null; diskTotal:number|null;
};
export type CheckHistory = {
  events:CheckEvent[]; services:string[]; older:number|null; lastWriteFailure:number|null;
  retentionDays:number; maxRecords:number;
};
const localTime = (at:number) => new Date(at).toLocaleString();
function capacity(used:number|null,total:number|null) {
  if (used === null || !total) return 'Unavailable';
  return Math.round(100 * used / total) + '% · ' + (used / 2**30).toFixed(1) + ' / ' + (total / 2**30).toFixed(1) + ' GiB';
}
export function MonitoringHistory({data,service,failures,loading,error,onService,onFailures,onRefresh,onOlder,onNewer,hasNewer}:{
  data:CheckHistory|null; service:string; failures:boolean; loading:boolean; error:boolean;
  onService:(value:string)=>void; onFailures:(value:boolean)=>void; onRefresh:()=>void;
  onOlder:()=>void; onNewer:()=>void; hasNewer:boolean;
}) {
  return <ResourceCanvas><main id="hub-main">
    <div className="zn-your-hub__toolbar"><h1 className="zn-your-hub__count">Monitoring history</h1>
      <a className="zn-your-hub__back" href="/settings">← Settings</a></div>
    <section className="zn-history" aria-label="Service check history">
      <p>CPU and memory are measured on the Hub host. Disk usage covers the volume containing Hub setup data.</p>
      <div className="zn-history__filters">
        <label>Service instance <select value={service} onChange={e=>onService(e.target.value)}>
          <option value="">All instances</option>{Array.from(new Set([...(data?.services||[]),...(service?[service]:[])])).map(s=><option key={s}>{s}</option>)}
        </select></label>
        <label><input type="checkbox" checked={failures} onChange={e=>onFailures(e.target.checked)}/> Failures only</label>
        <button type="button" disabled={loading} onClick={onRefresh}>Refresh history</button>
      </div>
      {error&&<p role="alert">History could not be read. Refresh to try again.</p>}
      {Boolean(data?.lastWriteFailure)&&<p role="status">Some checks could not be recorded. Last write failure at {localTime(data!.lastWriteFailure!)}.</p>}
      {loading&&<p role="status">Reading history…</p>}
      {data&&!data.events.length&&!error&&<p>No recorded checks match these filters.</p>}
      {Boolean(data?.events.length)&&<div className="zn-history__scroll" tabIndex={0} role="region" aria-label="Check results">
        <table><thead><tr>{['Checked at','Service instance','Check step','Result','Duration','Host CPU','Host memory','Setup disk'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{data!.events.map(e=><tr key={e.id}>
            <td><time dateTime={new Date(e.at).toISOString()}>{localTime(e.at)}</time></td><td>{e.service}</td><td>{e.step}</td>
            <td className={e.reason?'zn-history__failure':''}>{e.reason?'Failed · '+e.reason:'Passed'}</td>
            <td>{e.duration.toLocaleString()} ms</td><td>{e.cpu===null?'Unavailable':e.cpu.toFixed(1)+'%'}</td>
            <td>{capacity(e.memoryUsed,e.memoryTotal)}</td><td>{capacity(e.diskUsed,e.diskTotal)}</td>
          </tr>)}</tbody></table>
      </div>}
      {data&&<footer><span>Retains up to {data.maxRecords.toLocaleString()} checks for {data.retentionDays} days.</span>
        <button disabled={!hasNewer||loading} onClick={onNewer}>Newer</button><button disabled={!data.older||loading} onClick={onOlder}>Older</button>
      </footer>}
    </section>
  </main></ResourceCanvas>;
}
