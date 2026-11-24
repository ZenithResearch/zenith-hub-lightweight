"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {MatrixSetup,type MatrixInstance,type MatrixReview} from "@/vendor/zenith-ui/MatrixSetup/MatrixSetup";
type Snapshot={schema:string;csrf:string;busy:boolean;instances:MatrixInstance[];result?:{state:string;error?:string}};
export function MatrixSetupPanel({instanceId,onControl}:{instanceId:string;onControl:(action:string)=>void}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[review,setReview]=useState<MatrixReview|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const latest=useRef(snapshot);latest.current=snapshot;
 const decode=async(r:Response)=>{const value=await r.json();if(!r.ok)throw Error(value.error||"matrix_setup_unavailable");return value;};
 const load=useCallback(async()=>{setSnapshot(await decode(await fetch("/api/matrix",{cache:"no-store"})));},[]);
 useEffect(()=>{let active=true;setWorking(true);void (async()=>{const initial=await decode(await fetch("/api/matrix",{cache:"no-store"})) as Snapshot;if(!active)return;latest.current=initial;setSnapshot(initial);if(initial.instances.find(i=>i.instanceId===instanceId)?.enabled&&!initial.busy){const checked=await decode(await fetch("/api/matrix",{method:"POST",headers:{"content-type":"application/json","x-zenith-csrf":initial.csrf},body:JSON.stringify({schema:"zenith.hub-matrix-action.v1",operation:"refresh",instanceId})}));if(active)setSnapshot(checked);}})().catch(e=>{if(active)setError(e.message.replaceAll("_"," "));}).finally(()=>{if(active)setWorking(false);});return()=>{active=false;};},[instanceId]);
 const send=async(body:Record<string,unknown>)=>decode(await fetch("/api/matrix",{method:"POST",headers:{"content-type":"application/json","x-zenith-csrf":latest.current?.csrf||""},body:JSON.stringify({schema:"zenith.hub-matrix-action.v1",...body})}));
 async function perform(fn:()=>Promise<void>){if(working)return;setWorking(true);setError("");setNotice("");try{await fn();}catch(e){setError((e instanceof Error?e.message:String(e)).replaceAll("_"," "));}finally{setWorking(false);}}
 const instance=snapshot?.instances.find(i=>i.instanceId===instanceId);
 if(!snapshot||!instance)return <p role="status">{error||"Reading saved Matrix setup…"}</p>;
 return <><div className="zn-your-hub__actions">{instance.mode==="install"&&instance.running&&<button disabled={working} onClick={()=>onControl("stop")}>Review stop</button>}{instance.mode==="connect"&&<button disabled={working} onClick={()=>onControl(instance.enabled?"disconnect":"reconnect")}>{instance.enabled?"Disable Hub connection":"Reconnect Hub connection"}</button>}</div>
 <MatrixSetup instance={instance} review={review} busy={working} error={error} notice={notice}
 onRefresh={()=>void perform(async()=>{setSnapshot(await send({operation:"refresh",instanceId}));})}
 onReview={(action,args)=>void perform(async()=>{setReview((await send({operation:"review",instanceId,action,args})).plan);})}
 onResume={planId=>void perform(async()=>setReview((await send({operation:"read-review",planId})).plan))}
 onApply={secret=>void perform(async()=>{const value=await send({operation:"apply",planId:review!.id,...(secret?{secret}:{})});setReview(null);setSnapshot(value);setNotice(value.result?.error?value.result.error.replaceAll("_"," "):value.result?.state==="complete"?"Reviewed action completed.":"Check the retained action result.");await load();})}
 onCancel={()=>void perform(async()=>{await send({operation:"cancel",planId:review!.id});setReview(null);await load();})}
 onControl={onControl}/></>;
}
