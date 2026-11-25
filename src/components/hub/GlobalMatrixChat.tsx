"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {MatrixChat} from "@/vendor/zenith-ui/MatrixChat/MatrixChat";
import {projectMatrixChat} from "@/lib/hub/matrix-chat-view.mjs";
type Snapshot={schema:string;csrf:string;busy:boolean;instances:{instanceId:string;enabled:boolean;evidence:string;view?:{observedAt?:string}|null}[]};
export function GlobalMatrixChat({open,onClose}:{open:boolean;onClose:()=>void}){
 const router=useRouter(),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(false),[now,setNow]=useState(Date.now);
 const [selection,setSelection]=useState<{accountKey:string;spaceId:string|null;roomId:string|null}|null>(null);
 const request=useRef<AbortController|null>(null);
 const load=useCallback(async(force=false)=>{
  if(request.current)return;
  const abort=new AbortController();request.current=abort;setBusy(true);
  const read=async(options:RequestInit={})=>{
   const response=await fetch("/api/matrix",{...options,cache:"no-store",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
   if(!response.ok)throw Error("matrix_unavailable");const value=await response.json();
   if(value?.schema!=="zenith.hub-matrix.v1"||!Array.isArray(value.instances))throw Error("matrix_unavailable");
   return value as Snapshot;
  };
  try{
   let next=await read();if(abort.signal.aborted)return;
   setSnapshot(next);setLoading(false);setError(false);setNow(Date.now());
   if(!next.busy){
    const initial=next;
    for(const instance of initial.instances){
     const age=Date.now()-Date.parse(instance.view?.observedAt||"");
     if(instance.enabled&&(force||instance.evidence!=="fresh"||!Number.isFinite(age)||age>=25000)){
      next=await read({method:"POST",headers:{"content-type":"application/json","x-zenith-csrf":initial.csrf},body:JSON.stringify({schema:"zenith.hub-matrix-action.v1",operation:"refresh",instanceId:instance.instanceId})});
      if(abort.signal.aborted)return;setSnapshot(next);setNow(Date.now());
     }
    }
   }
  }catch{if(!abort.signal.aborted){setError(true);setLoading(false);}}
  finally{if(request.current===abort){request.current=null;setBusy(false);}}
 },[]);
 useEffect(()=>{
  if(!open)return;void load(true);
  const poll=setInterval(()=>{if(!document.hidden)void load();},15000);
  const tick=setInterval(()=>setNow(Date.now()),5000);
  const visible=()=>{if(!document.hidden)void load();};
  document.addEventListener("visibilitychange",visible);window.addEventListener("focus",visible);
  return()=>{document.removeEventListener("visibilitychange",visible);window.removeEventListener("focus",visible);clearInterval(poll);clearInterval(tick);request.current?.abort();request.current=null;};
 },[open,load]);
 if(!open)return null;
 return <MatrixChat model={projectMatrixChat({snapshot,loading,error,now})} busy={busy} selection={selection} onSelect={setSelection} onClose={onClose} onRefresh={()=>void load(true)} onNavigate={href=>{onClose();router.push(href);}}/>;
}
