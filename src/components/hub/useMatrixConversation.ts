"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {MatrixChatRoom,MatrixConversationModel} from "@/vendor/zenith-ui/MatrixChat/MatrixChat";
import {conversationSnapshot,conversationError,type ConversationPayload} from "@/lib/hub/conversation-view.mjs";
type Target={key:string;accountKey:string;instanceId:string;userId:string;deviceId:string;room:MatrixChatRoom};
type Attempt={target:Target;binding:string;message:string;transactionId:string};
type SendState={state:"idle"|"sending"|"uncertain";error:string};
export function useMatrixConversation({open,csrf,target}:{open:boolean;csrf:string;target:Target|null}){
 const [entry,setEntry]=useState<{key:string;value:ConversationPayload}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<{key:string;code:string}|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({}),[sends,setSends]=useState<Record<string,SendState>>({}),[clock,setClock]=useState(Date.now);
 const targetRef=useRef(target);targetRef.current=target;
 const entryRef=useRef(entry);entryRef.current=entry;
 const draftsRef=useRef(drafts);draftsRef.current=drafts;
 const readRequest=useRef<AbortController|null>(null),attempts=useRef(new Map<string,Attempt>()),sending=useRef(new Set<string>());
 const key=target?.key||"";
 const read=useCallback(async()=>{
  const selected=targetRef.current;if(!selected||!csrf||readRequest.current)return;
  const abort=new AbortController();readRequest.current=abort;setLoading(true);
  try{
   const response=await fetch('/api/matrix/conversation',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zenith-csrf':csrf},body:JSON.stringify({schema:'zenith.hub-matrix-conversation-action.v1',operation:'timeline',instanceId:selected.instanceId,roomId:selected.room.id}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(70000)])});
   const json=await response.json();if(!response.ok)throw Object.assign(Error(json.error),{code:json.error});
   const value=conversationSnapshot(json,{...selected,roomId:selected.room.id});
   if(!abort.signal.aborted&&targetRef.current?.key===selected.key){setEntry({key:selected.key,value});setError(null);setClock(Date.now());}
  }catch(e){if(!abort.signal.aborted&&targetRef.current?.key===selected.key){const code=(e as {code?:string}).code||'matrix_chat_unavailable';setError({key:selected.key,code});if(['matrix_chat_account_changed','matrix_chat_session_expired','matrix_chat_not_joined','matrix_chat_session_unavailable','matrix_chat_permission_denied','matrix_chat_connection_unavailable'].includes(code))setEntry(null);}}
  finally{if(readRequest.current===abort){readRequest.current=null;setLoading(false);}}
 },[csrf]);
 useEffect(()=>{
  if(!open||!key)return;void read();
  const poll=setInterval(()=>{setClock(Date.now());if(!document.hidden)void read();},5000),visible=()=>{if(!document.hidden)void read();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{clearInterval(poll);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);readRequest.current?.abort();readRequest.current=null;};
 },[open,key,read]);
 const deliver=useCallback(async(attempt:Attempt)=>{
  const id=attempt.target.key;if(sending.current.has(id))return;sending.current.add(id);setSends(s=>({...s,[id]:{state:'sending',error:''}}));
  try{
   const response=await fetch('/api/matrix/conversation',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zenith-csrf':csrf},body:JSON.stringify({schema:'zenith.hub-matrix-conversation-action.v1',operation:'send',instanceId:attempt.target.instanceId,roomId:attempt.target.room.id,binding:attempt.binding,message:attempt.message,transactionId:attempt.transactionId}),signal:AbortSignal.timeout(70000)});
   const json=await response.json();if(!response.ok)throw Object.assign(Error(json.error),{code:json.error});
   if(json.schema!=='zenith.hub-matrix-send.v1'||json.transactionId!==attempt.transactionId||typeof json.eventId!=='string')throw Error('matrix_chat_send_unknown');
   attempts.current.delete(id);setSends(s=>({...s,[id]:{state:'idle',error:''}}));setDrafts(d=>({...d,[id]:d[id]===attempt.message?'':d[id]||''}));
   if(targetRef.current?.key===id){await read();}
  }catch(e){
   const code=(e as {code?:string}).code||'matrix_chat_send_unknown',unknown=['matrix_chat_send_unknown','matrix_chat_unavailable','matrix_chat_account_changed','matrix_chat_encryption_changed','matrix_chat_transaction_changed'].includes(code);
   if(!unknown)attempts.current.delete(id);setSends(s=>({...s,[id]:{state:unknown?'uncertain':'idle',error:conversationError(code)}}));
  }finally{sending.current.delete(id);}
 },[csrf,read]);
 const send=()=>{
  const selected=targetRef.current,current=entryRef.current;if(!selected||current?.key!==selected.key||!current.value.canSend||Date.now()-Date.parse(current.value.observedAt)>30000||attempts.current.has(selected.key))return;
  const message=draftsRef.current[selected.key]||'';if(!message.trim())return;
  const attempt={target:selected,binding:current.value.binding,message,transactionId:'hub_'+crypto.randomUUID()};attempts.current.set(selected.key,attempt);void deliver(attempt);
 };
 const retry=()=>{const selected=targetRef.current,attempt=selected&&attempts.current.get(selected.key);if(attempt)void deliver(attempt);};
 const payload=entry?.key===key?entry.value:null,currentError=error?.key===key?error.code:'',sendState=sends[key]||{state:'idle',error:''};
 const fresh=payload&&clock-Date.parse(payload.observedAt)<=30000;
 const notice=payload?.cryptoError?conversationError(payload.cryptoError):currentError?conversationError(currentError):payload?.messages.some(m=>m.kind==='encrypted')?'Some older messages are waiting for this device’s encryption keys.':payload&&!payload.canSend?'This room is currently read-only.':'';
 const model:MatrixConversationModel|undefined=target?{accountKey:target.accountKey,room:target.room,state:loading&&!payload?'loading':payload&&!currentError?'ready':'unavailable',messages:payload?.messages||[],canSend:!!fresh&&payload?.canSend===true&&!currentError,notice,error:sendState.error,sendState:sendState.state}:undefined;
 return {model,draft:drafts[key]||'',setDraft:(text:string)=>{if(key)setDrafts(d=>({...d,[key]:text.slice(0,4000)}));},send,retry,refresh:()=>void read()};
}
