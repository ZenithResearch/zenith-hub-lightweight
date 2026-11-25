"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {MainHub} from "@/vendor/zenith-ui/MainHub/MainHub";
import {projectMainHub} from "@/lib/hub/main-view.mjs";
import {useHubWorkspaceState} from "./HubWorkspaceState";
type MatrixSnapshot={schema:string;csrf:string;busy:boolean;instances:{instanceId:string;enabled:boolean;view?:{observedAt?:string}}[]};
type Evidence={hub:unknown;matrix:MatrixSnapshot|null;errors:{hub?:string;matrix?:string};loading:boolean;busy:boolean};
export function MainHubPage(){
 const router=useRouter(),workspace=useHubWorkspaceState();
 const [evidence,setEvidence]=useState<Evidence>({hub:null,matrix:null,errors:{},loading:true,busy:false});
 const [now,setNow]=useState(Date.now);
 const alive=useRef(false),sequence=useRef(0),inFlight=useRef(false),request=useRef<AbortController|null>(null);
 const latest=useRef(evidence);latest.current=evidence;
 const load=useCallback(async(force=false)=>{
  if(inFlight.current)return;
  const ticket=++sequence.current,abort=new AbortController();request.current=abort;inFlight.current=true;
  if(alive.current)setEvidence(old=>({...old,busy:true}));
  const read=async(url:string,options:RequestInit={})=>{
   const response=await fetch(url,{...options,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]),cache:"no-store"});
   if(!response.ok)throw Error("Connection check failed");
   return response.json();
  };
  try{
   const responses=await Promise.allSettled([read("/api/hub"),read("/api/matrix")]);
   const errors:Evidence["errors"]={};
   let hub=latest.current.hub,matrix=latest.current.matrix;
   if(responses[0].status==="fulfilled")hub=responses[0].value;else errors.hub="unavailable";
   if(responses[1].status==="fulfilled"&&responses[1].value?.schema==="zenith.hub-matrix.v1")matrix=responses[1].value;else errors.matrix="unavailable";
   // Render saved summaries immediately; a slow remote verification must not hide Work.
   if(alive.current&&ticket===sequence.current){setEvidence({hub,matrix,errors:{...errors},loading:false,busy:true});setNow(Date.now());}
   if(matrix&&!matrix.busy&&!errors.matrix){
    // Existing refresh verifies account/room evidence. It cannot log in, join, send or configure.
    const refreshSnapshot=matrix;
    for(const instance of refreshSnapshot.instances){
     const age=Date.now()-Date.parse(instance.view?.observedAt||"");
     if(instance.enabled&&(force||!Number.isFinite(age)||age>=25000)){
      try{
       matrix=await read("/api/matrix",{method:"POST",headers:{"content-type":"application/json","x-zenith-csrf":refreshSnapshot.csrf},body:JSON.stringify({schema:"zenith.hub-matrix-action.v1",operation:"refresh",instanceId:instance.instanceId})});
      }catch(error){if(abort.signal.aborted)throw error;errors.matrix="unavailable";break;}
     }
    }
   }
   if(alive.current&&ticket===sequence.current){setEvidence({hub,matrix,errors,loading:false,busy:false});setNow(Date.now());}
  }catch{
   if(!abort.signal.aborted&&alive.current&&ticket===sequence.current)setEvidence(old=>({...old,loading:false,busy:false,errors:{hub:"unavailable",matrix:"unavailable"}}));
  }finally{if(ticket===sequence.current){inFlight.current=false;request.current=null;}}
 },[]);
 useEffect(()=>{
  alive.current=true;void load();
  const poll=setInterval(()=>{if(!document.hidden)void load();},15000);
  const tick=setInterval(()=>setNow(Date.now()),5000);
  const focus=()=>{if(!document.hidden)void load();};
  window.addEventListener("focus",focus);
  return()=>{alive.current=false;sequence.current++;inFlight.current=false;request.current?.abort();clearInterval(poll);clearInterval(tick);window.removeEventListener("focus",focus);};
 },[load]);
 const onNavigate=useCallback((href:string)=>router.push(href),[router]);
 return <MainHub model={projectMainHub({...evidence,now})} busy={evidence.busy} selectedConversationKey={workspace.selectedConversationKey} onSelectConversation={workspace.selectConversation} onNavigate={onNavigate} onRefresh={()=>void load(true)}/>;
}
