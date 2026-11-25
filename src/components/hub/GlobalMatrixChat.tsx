"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {useMatrixStart} from "./useMatrixStart";
import {useMatrixConversation} from "./useMatrixConversation";
import {MatrixChat,type MatrixChatRoom} from "@/vendor/zenith-ui/MatrixChat/MatrixChat";
import {projectMatrixChat} from "@/lib/hub/matrix-chat-view.mjs";
type Snapshot={schema:string;csrf:string;busy:boolean;instances:{instanceId:string;enabled:boolean;endpoint:string;reviewId?:string|null;evidence:string;account?:{userId:string;deviceId:string}|null;view?:{observedAt?:string}|null}[]};
export function GlobalMatrixChat({open,onClose,preview=false,onHoverEnter,onHoverLeave,onInteract}:{open:boolean;onClose:()=>void;preview?:boolean;onHoverEnter?:()=>void;onHoverLeave?:()=>void;onInteract?:()=>void}){
 const router=useRouter(),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(false),[now,setNow]=useState(Date.now);
 const [selection,setSelection]=useState<{accountKey:string;spaceId:string|null;roomId:string|null}|null>(null);
 const request=useRef<AbortController|null>(null),mutation=useRef(false),composing=useRef(false),pendingRoom=useRef<{accountKey:string;roomId:string}|null>(null);
 const [activeRoom,setActiveRoom]=useState<{accountKey:string;room:MatrixChatRoom}|null>(null);
 const load=useCallback(async(force=false)=>{
  if(request.current||mutation.current)return;
  const abort=new AbortController();request.current=abort;setBusy(true);
  const read=async(options:RequestInit={})=>{
   const response=await fetch("/api/matrix",{...options,cache:"no-store",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(options.method==="POST"?90000:20000)])});
   if(!response.ok)throw Error("matrix_unavailable");const value=await response.json();
   if(value?.schema!=="zenith.hub-matrix.v1"||!Array.isArray(value.instances))throw Error("matrix_unavailable");
   return value as Snapshot;
  };
  try{
   let next=await read();if(abort.signal.aborted)return;
   setSnapshot(next);setLoading(false);setError(false);setNow(Date.now());
   if(!next.busy&&!composing.current){
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
 const model=projectMatrixChat({snapshot,loading,error,now});
 const account=model.accounts.find(a=>a.key===selection?.accountKey)||model.accounts[0];
 const instance=snapshot?.instances.find(i=>i.instanceId===account?.instanceId);
 const room=activeRoom&&account&&selection&&selection.accountKey===account.key&&selection.roomId===activeRoom.room.id&&activeRoom.accountKey===account.key?activeRoom.room:null;
 const target=room&&account&&instance?.account?{key:account.key+"/"+room.id,accountKey:account.key,instanceId:instance.instanceId,userId:instance.account.userId,deviceId:instance.account.deviceId,room}:null;
 const conversation=useMatrixConversation({open,csrf:snapshot?.csrf||"",target});
 const start=useMatrixStart({context:account&&instance?.account?{key:account.key,instanceId:instance.instanceId,userId:instance.account.userId,deviceId:instance.account.deviceId,endpoint:instance.endpoint,reviewId:instance.reviewId}:null,csrf:snapshot?.csrf||"",onSnapshot:value=>{setSnapshot(value as Snapshot);setError(false);setNow(Date.now());},onRoom:(accountKey,roomId)=>{pendingRoom.current={accountKey,roomId};void load(true);},onBusy:value=>{mutation.current=value;if(value)request.current?.abort();else if(pendingRoom.current)void load(true);}});
 useEffect(()=>{const wanted=pendingRoom.current;if(!wanted)return;const a=model.accounts.find(a=>a.key===wanted.accountKey),r=a?.rooms.find(r=>r.id===wanted.roomId);if(r){setActiveRoom({accountKey:a!.key,room:r});setSelection({accountKey:a!.key,spaceId:null,roomId:r.id});pendingRoom.current=null;}},[model]);
 useEffect(()=>{const before=composing.current;composing.current=!!start.model;if(before&&!composing.current&&open)void load(true);},[!!start.model,open,load]);
 function newConversation(){if(account){composing.current=true;request.current?.abort();setActiveRoom(null);setSelection({accountKey:account.key,spaceId:null,roomId:null});start.open();}}
 function select(value:{accountKey:string;spaceId:string|null;roomId:string|null}){const a=model.accounts.find(a=>a.key===value.accountKey),r=a?.rooms.find(r=>r.id===value.roomId);setActiveRoom(r?{accountKey:value.accountKey,room:r}:null);setSelection(value);}
 if(!open)return null;
 return <MatrixChat start={start.model} onStart={newConversation} onStartKind={start.kind} onStartDraft={start.draft} onStartReview={start.review} onStartApply={start.apply} onStartCancel={start.cancel} onStartCheck={start.check} onJoinInvitation={roomId=>{newConversation();start.review("join-room",{roomId});}} autoFocus={!preview} onHoverEnter={onHoverEnter} onHoverLeave={onHoverLeave} onInteract={onInteract} model={model} conversation={conversation.model} draft={conversation.draft} onDraftChange={conversation.setDraft} onSendMessage={conversation.send} onRetryMessage={conversation.retry} onRefreshConversation={conversation.refresh} busy={busy||start.busy} selection={selection} onSelect={select} onClose={onClose} onRefresh={()=>void load(true)} onNavigate={href=>{onClose();router.push(href);}}/>;
}
