"use client";
import {useEffect,useState} from 'react';
import {MonitoringHistory,type CheckHistory} from '@/vendor/zenith-ui/YourHub/MonitoringHistory';

export function HistoryPage() {
  const [service,setService]=useState(''), [failures,setFailures]=useState(false);
  const [pages,setPages]=useState<number[]>([]), [revision,refresh]=useState(0);
  const [data,setData]=useState<CheckHistory|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState(false);
  const before=pages.at(-1);
  useEffect(()=>{
    const abort=new AbortController();
    const params=new URLSearchParams();
    if(service)params.set('service',service);
    if(failures)params.set('failures','1');
    if(before)params.set('before',String(before));
    async function read(){
      setLoading(true);setError(false);
      try{
        const r=await fetch('/api/hub/history?'+params,{cache:'no-store',signal:abort.signal});
        if(!r.ok)throw Error('history_unavailable');
        const next=await r.json() as CheckHistory;
        if(!abort.signal.aborted)setData(next);
      }catch{if(!abort.signal.aborted)setError(true);}
      finally{if(!abort.signal.aborted)setLoading(false);}
    }
    void read();
    return ()=>abort.abort();
  },[before,service,failures,revision]);
  return <MonitoringHistory data={data} loading={loading} error={error} failures={failures} service={service}
    onService={v=>{setData(null);setPages([]);setService(v);}} onFailures={v=>{setData(null);setPages([]);setFailures(v);}}
    hasNewer={pages.length>0} onNewer={()=>{setData(null);setPages(p=>p.slice(0,-1));}}
    onOlder={()=>{if(data?.older){setPages(p=>[...p,data.older!]);setData(null);}}}
    onRefresh={()=>refresh(r=>r+1)}/>;
}
