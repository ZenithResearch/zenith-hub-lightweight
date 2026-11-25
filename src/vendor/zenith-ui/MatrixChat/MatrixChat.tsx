"use client";
import {useEffect,useId,useRef,useState} from "react";
import "./MatrixChat.css";
import {MatrixConversation,type MatrixConversationModel} from "./MatrixConversation.tsx";
export type {MatrixConversationModel,MatrixConversationMessage} from "./MatrixConversation.tsx";
export type MatrixChatRoom={id:string;name:string;topic:string;encrypted:boolean;openHref:string};
export type MatrixChatSpace={id:string;name:string;children:string[]};
export type MatrixChatAccount={instanceId?:string;key:string;label:string;userId:string|null;state:string;message:string;settingsHref:string;complete:boolean;rooms:MatrixChatRoom[];spaces:MatrixChatSpace[];invitations:number|null};
export type MatrixChatModel={loading:boolean;error:string;accounts:MatrixChatAccount[]};
import {roomsInSpace} from "./matrix-spaces.ts";
export {roomsInSpace} from "./matrix-spaces.ts";
export function MatrixChat({model,busy,selection,onSelect,onClose,onRefresh,onNavigate,autoFocus=true,onHoverEnter,onHoverLeave,onInteract,conversation,draft="",onDraftChange,onSendMessage,onRetryMessage,onRefreshConversation}:{conversation?:MatrixConversationModel;draft?:string;onDraftChange?:(text:string)=>void;onSendMessage?:()=>void;onRetryMessage?:()=>void;onRefreshConversation?:()=>void;autoFocus?:boolean;onHoverEnter?:()=>void;onHoverLeave?:()=>void;onInteract?:()=>void;model:MatrixChatModel;busy:boolean;selection:{accountKey:string;spaceId:string|null;roomId:string|null}|null;onSelect:(value:{accountKey:string;spaceId:string|null;roomId:string|null})=>void;onClose:()=>void;onRefresh:()=>void;onNavigate:(href:string)=>void}){
 const dialog=useRef<HTMLElement>(null);
 // Hover previews must not take focus from another input.
 useEffect(()=>{if(autoFocus)dialog.current?.focus();},[]);
 const titleId=useId(),account=model.accounts.find(a=>a.key===selection?.accountKey)||model.accounts[0];
 const spaceId=selection&&account?.key===selection.accountKey?selection.spaceId:null;
 const activeConversation=conversation&&conversation.accountKey===account?.key&&conversation.room.id===selection?.roomId?conversation:undefined;
 const room=selection&&account?.key===selection.accountKey?account.rooms.find(r=>r.id===selection.roomId)||activeConversation?.room:undefined;
 const valid=account&&["verified","partial"].includes(account.state);
 const selectedSpace=account?.spaces.find(s=>s.id===spaceId);
 const rooms=account?roomsInSpace(account,selectedSpace?.id||null):[];
 const handle=account?.userId?.split(":")[0].slice(1)||account?.label||"Matrix";
 const connectionStatus=valid||activeConversation?.state==="ready"?"Connected":busy?"Checking connection…":"Needs attention";
 function settings(event:React.MouseEvent<HTMLAnchorElement>,href:string){if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(href);}}
 return <section ref={dialog} tabIndex={-1} id="zenith-matrix-chat" className="zn-matrix-chat" onPointerEnter={onHoverEnter} onPointerLeave={onHoverLeave}
   onPointerDown={()=>onInteract?.()} onClickCapture={()=>onInteract?.()} onFocusCapture={()=>onHoverEnter?.()}
   onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))onHoverLeave?.();}}
   role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();onClose();}}}>
  <header className="zn-matrix-chat__header">
   <div className="zn-matrix-chat__brand"><MessengerMark/><h2 id={titleId}>{room?.name||"Matrix"}</h2><span aria-hidden="true">{room?"Matrix":"Messenger"}</span></div>
   <div className="zn-matrix-chat__window-controls"><button type="button" onClick={room&&onRefreshConversation?onRefreshConversation:onRefresh} disabled={!room&&busy} aria-label={room?"Refresh conversation":"Refresh Matrix rooms and spaces"} title="Refresh"><ChatGlyph kind="refresh"/></button><button type="button" onClick={onClose} aria-label="Minimize Matrix chat" title="Minimize"><ChatGlyph kind="minimize"/></button></div>
  </header>
  {model.error&&!room&&<p className="zn-matrix-chat__notice" role="status">{model.error}</p>}
  {model.loading&&!account?<p role="status" className="zn-matrix-chat__notice">Reading your Matrix connections…</p>:!account?<div className="zn-matrix-chat__notice"><p>Connect a Matrix account to see its rooms and spaces.</p><a href="/settings?component=matrix" onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate("/settings?component=matrix");}}}>Configure Matrix →</a></div>:<>
   {!room&&<div className="zn-matrix-chat__account">
    <div className="zn-matrix-chat__avatar" aria-hidden="true"><MessengerMark/></div>
    <div className="zn-matrix-chat__identity">
     {model.accounts.length>1?<label>Account<select value={account.key} onChange={event=>onSelect({accountKey:event.target.value,spaceId:null,roomId:null})}>{model.accounts.map(a=><option key={a.key} value={a.key}>{a.userId||a.label}</option>)}</select></label>:<strong title={account.userId||account.label}>{handle}</strong>}
     <span className="zn-matrix-chat__connection"><i className={valid?"is-connected":""} aria-hidden="true"/>{connectionStatus}</span>
     <span className="zn-matrix-chat__address" title={account.userId||account.label}>{account.userId||account.label}</span>
    </div>
    <a className="zn-matrix-chat__settings" href={account.settingsHref} aria-label="Matrix settings" title="Settings" onClick={event=>settings(event,account.settingsHref)}><ChatGlyph kind="settings"/></a>
   </div>}
   {account.message&&!room&&<p className="zn-matrix-chat__notice" role="status">{busy&&account.state==="stale"?"Refreshing your rooms…":account.message}</p>}
   {room?<MatrixConversation model={activeConversation||{accountKey:account.key,room,state:"unavailable",messages:[],canSend:false,notice:"Chat client setup is required for this account.",error:"",sendState:"idle"}} draft={draft} onDraftChange={onDraftChange} onSend={onSendMessage} onRetry={onRetryMessage} onRefresh={onRefreshConversation} onBack={()=>onSelect({accountKey:account.key,spaceId:selectedSpace?.id||null,roomId:null})}/>:valid?<div className="zn-matrix-chat__body">
    <MatrixSpacesCarousel spaces={account.spaces} selectedId={selectedSpace?.id||null} complete={account.complete} onSelect={id=>onSelect({accountKey:account.key,spaceId:id,roomId:null})}/>
    <div className="zn-matrix-chat__rooms"><h3>Rooms{selectedSpace&&<span className="zn-matrix-chat__selected-space"> · {selectedSpace.name}</span>}</h3>
     {rooms.length?<ul>{rooms.map(item=><li key={item.id}><button type="button" onClick={()=>onSelect({accountKey:account.key,spaceId:selectedSpace?.id||null,roomId:item.id})}><span className="zn-matrix-chat__room-avatar" aria-hidden="true">{Array.from(item.name.trim())[0]?.toUpperCase()||"#"}</span><span className="zn-matrix-chat__room-summary"><span>{item.name}</span><small>{item.topic||(item.encrypted?"Encrypted room":"Matrix room")}</small></span>{item.encrypted&&<span className="zn-matrix-chat__lock" role="img" aria-label="Encrypted" title="Encrypted room"><ChatGlyph kind="lock"/></span>}</button></li>)}</ul>:<p className="zn-matrix-chat__empty">{account.complete?(selectedSpace?"No joined rooms in this space.":"No joined rooms yet."):"The room list is incomplete."}</p>}
     {account.invitations!==null&&account.invitations>0&&<a className="zn-matrix-chat__invites" href={account.settingsHref} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(account.settingsHref);}}}>{account.invitations} invitations · review in Settings</a>}
    </div>
   </div>:<div className="zn-matrix-chat__notice"><a href={account.settingsHref} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(account.settingsHref);}}}>Open Matrix settings →</a></div>}
  </>}
  <footer className="zn-matrix-chat__footer"><span>{room?handle:"Matrix"}</span><span>{room?(room.encrypted?"Encrypted":"Conversation"):busy?"Refreshing…":valid?(account.complete?`${rooms.length} ${rooms.length===1?"room":"rooms"}`:`${rooms.length} rooms shown`):"Rooms & spaces"}</span></footer>
 </section>;
}


function MatrixSpacesCarousel({spaces,selectedId,complete,onSelect}:{spaces:MatrixChatSpace[];selectedId:string|null;complete:boolean;onSelect:(id:string|null)=>void}){
 const rail=useRef<HTMLDivElement>(null),[ends,setEnds]=useState({left:false,right:false});
 const items=[{id:null,name:"All rooms"},...spaces];
 const signature=spaces.map(s=>s.id+s.name).join("|");
 function update(){const node=rail.current;if(node)setEnds({left:node.scrollLeft>2,right:node.scrollLeft+node.clientWidth<node.scrollWidth-2});}
 useEffect(()=>{
  const node=rail.current;if(!node)return;
  const observer=new ResizeObserver(update);observer.observe(node);update();
  return()=>observer.disconnect();
 },[signature]);
 function scroll(direction:number){const node=rail.current;if(node)node.scrollBy({left:direction*node.clientWidth*.75,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}
 return <div className="zn-matrix-chat__spaces-carousel" role="region" aria-label="Matrix spaces" aria-roledescription="carousel">
  <div className="zn-matrix-chat__spaces-heading"><h3>Spaces</h3>{!spaces.length&&<span>{complete?"No joined spaces.":"No verified spaces yet."}</span>}
   {(ends.left||ends.right)&&<div><button type="button" aria-label="Previous spaces" disabled={!ends.left} onClick={()=>scroll(-1)}>‹</button><button type="button" aria-label="Next spaces" disabled={!ends.right} onClick={()=>scroll(1)}>›</button></div>}
  </div>
  <div ref={rail} className="zn-matrix-chat__space-rail" onScroll={update} onKeyDown={event=>{
   if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
   const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
   const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
   const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
   event.preventDefault();buttons[next]?.focus();buttons[next]?.scrollIntoView({block:"nearest",inline:"nearest"});
  }}>{items.map(item=><button type="button" key={item.id||"all"} aria-pressed={item.id===selectedId} title={item.name} onClick={()=>onSelect(item.id)}>{item.name}</button>)}</div>
 </div>;
}

function MessengerMark(){
 return <svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="11" cy="25" rx="9" ry="5" fill="#2268a3" opacity=".18"/><path d="M3 25c0-6 3-10 8-10s8 4 8 10c-4 3-12 3-16 0Z" fill="#3e90d9" stroke="#2f73ae"/><circle cx="11" cy="10" r="6" fill="#82caf1" stroke="#3d8cc3"/><path d="M15 28c0-6 3-10 7-10s8 4 8 10c-4 3-11 3-15 0Z" fill="#45b674" stroke="#2d945c"/><circle cx="22" cy="13" r="5.5" fill="#9ee1ac" stroke="#4eae70"/><path d="M7 8c1-2 4-3 6-2M19 11c1-2 3-2 5-1" stroke="#ffffffc0" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>;
}
function ChatGlyph({kind}:{kind:"refresh"|"minimize"|"settings"|"lock"}){
 return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{kind==="refresh"?<><path d="M16 8a6 6 0 1 0-1 7M16 3v5h-5"/></>:kind==="minimize"?<path d="M5 14h10"/>:kind==="lock"?<><rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V6a3 3 0 0 1 6 0v3M10 12v2"/></>:<><path d="m8 3 4 0 .5 2 2 1 2-.5 2 3-1.5 1.5v2l1.5 1.5-2 3-2-.5-2 1-.5 2H8l-.5-2-2-1-2 .5-2-3L3 12V10L1.5 8.5l2-3 2 .5 2-1L8 3Z" transform="translate(1 -1) scale(.9)"/><circle cx="10" cy="10" r="2.5"/></>}</svg>;
}
