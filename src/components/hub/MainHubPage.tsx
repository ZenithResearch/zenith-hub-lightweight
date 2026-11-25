"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {MainHub} from "@/vendor/zenith-ui/MainHub/MainHub";
import {projectMainHub} from "@/lib/hub/main-view.mjs";
type Evidence={hub:unknown;errors:{hub?:string};loading:boolean;busy:boolean};
export function MainHubPage(){
 const router=useRouter();
 const [evidence,setEvidence]=useState<Evidence>({hub:null,errors:{},loading:true,busy:false});
 const [now,setNow]=useState(Date.now);
 const alive=useRef(false),inFlight=useRef(false),request=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  if(inFlight.current)return;
  const abort=new AbortController();request.current=abort;inFlight.current=true;
  setEvidence(old=>({...old,busy:true}));
  try{
   const response=await fetch("/api/hub",{cache:"no-store",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
   if(!response.ok)throw Error("Connection check failed");
   const hub=await response.json();
   if(hub?.schema!=="zenith.hub-overview.v1")throw Error("Invalid Hub snapshot");
   if(alive.current&&request.current===abort){setEvidence({hub,errors:{},loading:false,busy:false});setNow(Date.now());}
  }catch{
   if(!abort.signal.aborted&&alive.current&&request.current===abort)setEvidence(old=>({...old,errors:{hub:"unavailable"},loading:false,busy:false}));
  }finally{if(request.current===abort){request.current=null;inFlight.current=false;}}
 },[]);
 useEffect(()=>{
  alive.current=true;void load();
  const poll=setInterval(()=>{if(!document.hidden)void load();},15000);
  const tick=setInterval(()=>setNow(Date.now()),5000);
  const focus=()=>{if(!document.hidden)void load();};
  window.addEventListener("focus",focus);
  return()=>{alive.current=false;inFlight.current=false;request.current?.abort();request.current=null;clearInterval(poll);clearInterval(tick);window.removeEventListener("focus",focus);};
 },[load]);
 const onNavigate=useCallback((href:string)=>router.push(href),[router]);
 return <MainHub showConversations={false} model={projectMainHub({...evidence,now,includeConversations:false})} busy={evidence.busy} onSelectConversation={()=>{}} onNavigate={onNavigate} onRefresh={()=>void load()}/>;
}
