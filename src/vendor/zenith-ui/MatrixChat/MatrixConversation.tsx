"use client";
import {useEffect,useRef} from "react";
export type MatrixConversationMessage={id:string;sender:string;mine:boolean;at:number;body:string;kind:"text"|"encrypted"|"notice"};
export type MatrixConversationModel={accountKey:string;room:{id:string;name:string;topic:string;encrypted:boolean};state:"loading"|"ready"|"unavailable";messages:MatrixConversationMessage[];canSend:boolean;notice:string;error:string;sendState:"idle"|"sending"|"uncertain"};
export function MatrixConversation({model,draft,onDraftChange,onSend,onRetry,onRefresh,onBack}:{model:MatrixConversationModel;draft:string;onDraftChange?:(text:string)=>void;onSend?:()=>void;onRetry?:()=>void;onRefresh?:()=>void;onBack:()=>void}){
 const timeline=useRef<HTMLDivElement>(null),atEnd=useRef(true);
 const signature=model.messages.map(m=>m.id+":"+m.body).join("|");
 useEffect(()=>{if(atEnd.current&&timeline.current)timeline.current.scrollTop=timeline.current.scrollHeight;},[signature]);
 const sending=model.sendState==="sending",uncertain=model.sendState==="uncertain",canSend=model.canSend&&!!draft.trim()&&!sending&&!uncertain&&!!onSend;
 return <div className="zn-matrix-conversation">
  <div className="zn-matrix-conversation__toolbar"><button type="button" onClick={onBack} aria-label="Back to rooms">‹ Rooms</button><span title={model.room.topic||model.room.name}>{model.room.name}</span>{model.room.encrypted&&<small>Encrypted</small>}</div>
  {model.notice&&<p className="zn-matrix-conversation__notice" role="status">{model.notice}</p>}
  <div ref={timeline} className="zn-matrix-conversation__timeline" role="log" aria-label={model.room.name+" messages"} aria-live="polite" aria-relevant="additions text" onScroll={()=>{const n=timeline.current;if(n)atEnd.current=n.scrollHeight-n.scrollTop-n.clientHeight<40;}}>
   {model.state==="loading"&&!model.messages.length?<p className="zn-matrix-conversation__empty">Opening conversation…</p>:!model.messages.length?<p className="zn-matrix-conversation__empty">{model.state==="ready"?"No messages yet. Say hello.":"Messages could not be loaded. Your draft stays here."}</p>:model.messages.map(message=><article key={message.id} className={"zn-matrix-conversation__message"+(message.mine?" is-own":"")+(message.kind!=="text"?" is-notice":"")}><div><strong title={message.sender}>{message.mine?"You":message.sender.split(":")[0].replace(/^@/,"")}</strong><time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></div><p>{message.body}</p></article>)}
  </div>
  {model.error&&<div className="zn-matrix-conversation__error" role="status"><span>{model.error}</span>{uncertain&&<button type="button" onClick={onRetry}>Retry same message</button>}</div>}
  <form className="zn-matrix-conversation__composer" onSubmit={event=>{event.preventDefault();if(canSend)onSend?.();}}>
   <textarea aria-label="Message this Matrix room" placeholder="Type a message…" value={draft} maxLength={4000} rows={2} disabled={sending||uncertain} onChange={event=>onDraftChange?.(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(canSend)onSend?.();}}}/>
   <div><span>{sending?"Sending…":model.room.encrypted?"Encrypted conversation":"Enter to send · Shift+Enter for a new line"}</span><button type="submit" disabled={!canSend}>Send</button></div>
  </form>
 </div>;
}
