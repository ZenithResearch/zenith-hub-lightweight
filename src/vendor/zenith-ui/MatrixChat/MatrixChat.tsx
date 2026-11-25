"use client";
import {useEffect,useId,useRef,useState} from "react";
import "./MatrixChat.css";
export type MatrixChatRoom={id:string;name:string;topic:string;encrypted:boolean;openHref:string};
export type MatrixChatSpace={id:string;name:string;children:string[]};
export type MatrixChatAccount={key:string;label:string;userId:string|null;state:string;message:string;settingsHref:string;complete:boolean;rooms:MatrixChatRoom[];spaces:MatrixChatSpace[];invitations:number|null};
export type MatrixChatModel={loading:boolean;error:string;accounts:MatrixChatAccount[]};
import {roomsInSpace} from "./matrix-spaces.ts";
export {roomsInSpace} from "./matrix-spaces.ts";
export function MatrixChat({model,busy,selection,onSelect,onClose,onRefresh,onNavigate,autoFocus=true,onHoverEnter,onHoverLeave,onInteract}:{autoFocus?:boolean;onHoverEnter?:()=>void;onHoverLeave?:()=>void;onInteract?:()=>void;model:MatrixChatModel;busy:boolean;selection:{accountKey:string;spaceId:string|null;roomId:string|null}|null;onSelect:(value:{accountKey:string;spaceId:string|null;roomId:string|null})=>void;onClose:()=>void;onRefresh:()=>void;onNavigate:(href:string)=>void}){
 const dialog=useRef<HTMLElement>(null);
 // Hover previews must not take focus from another input.
 useEffect(()=>{if(autoFocus)dialog.current?.focus();},[]);
 const titleId=useId(),account=model.accounts.find(a=>a.key===selection?.accountKey)||model.accounts[0];
 const spaceId=selection&&account?.key===selection.accountKey?selection.spaceId:null;
 const room=selection&&account?.key===selection.accountKey?account.rooms.find(r=>r.id===selection.roomId):undefined;
 const valid=account&&["verified","partial"].includes(account.state);
 const selectedSpace=account?.spaces.find(s=>s.id===spaceId);
 const rooms=account?roomsInSpace(account,selectedSpace?.id||null):[];
 return <section ref={dialog} tabIndex={-1} id="zenith-matrix-chat" className="zn-matrix-chat" onPointerEnter={onHoverEnter} onPointerLeave={onHoverLeave}
   onPointerDown={()=>onInteract?.()} onClickCapture={()=>onInteract?.()} onFocusCapture={()=>onHoverEnter?.()}
   onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))onHoverLeave?.();}}
   role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();onClose();}}}>
  <header className="zn-matrix-chat__header"><h2 id={titleId}>Matrix</h2><div><button type="button" onClick={onRefresh} disabled={busy} aria-label="Refresh Matrix rooms and spaces">↻</button><button type="button" onClick={onClose} aria-label="Minimize Matrix chat">−</button></div></header>
  {model.error&&<p className="zn-matrix-chat__notice" role="status">{model.error}</p>}
  {model.loading&&!account?<p role="status" className="zn-matrix-chat__notice">Reading your Matrix connections…</p>:!account?<div className="zn-matrix-chat__notice"><p>Connect a Matrix account to see its rooms and spaces.</p><a href="/settings?component=matrix" onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate("/settings?component=matrix");}}}>Configure Matrix →</a></div>:<>
   <div className="zn-matrix-chat__account">{model.accounts.length>1?<label>Account<select value={account.key} onChange={event=>onSelect({accountKey:event.target.value,spaceId:null,roomId:null})}>{model.accounts.map(a=><option key={a.key} value={a.key}>{a.userId||a.label}</option>)}</select></label>:<span title={account.userId||account.label}>{account.userId||account.label}</span>}<a href={account.settingsHref} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(account.settingsHref);}}}>Settings</a></div>
   {account.message&&<p className="zn-matrix-chat__notice" role="status">{account.message}</p>}
   {valid?<div className="zn-matrix-chat__body">
    <MatrixSpacesCarousel spaces={account.spaces} selectedId={selectedSpace?.id||null} complete={account.complete} onSelect={id=>onSelect({accountKey:account.key,spaceId:id,roomId:null})}/>
    <div className="zn-matrix-chat__rooms"><h3>Rooms{selectedSpace&&<span className="zn-matrix-chat__selected-space"> · {selectedSpace.name}</span>}</h3>
     {rooms.length?<ul>{rooms.map(item=><li key={item.id}><button type="button" aria-pressed={room?.id===item.id} onClick={()=>onSelect({accountKey:account.key,spaceId:selectedSpace?.id||null,roomId:item.id})}><span>{item.name}</span>{item.encrypted&&<small>Encrypted</small>}</button></li>)}</ul>:<p className="zn-matrix-chat__empty">{account.complete?(selectedSpace?"No joined rooms in this space.":"No joined rooms yet."):"The room list is incomplete."}</p>}
     {room&&<section className="zn-matrix-chat__room" aria-label={room.name+" room"}><h4>{room.name}</h4>{room.topic&&<p>{room.topic}</p>}<p>{room.encrypted?"Encrypted messages require an encryption-capable Matrix client.":"In-Hub message reading and sending are not connected yet."}</p><a href={room.openHref} target="_blank" rel="noreferrer">Open room in Matrix client ↗</a></section>}
     {account.invitations!==null&&account.invitations>0&&<a className="zn-matrix-chat__invites" href={account.settingsHref} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(account.settingsHref);}}}>{account.invitations} invitations · review in Settings</a>}
    </div>
   </div>:<div className="zn-matrix-chat__notice"><a href={account.settingsHref} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(account.settingsHref);}}}>Open Matrix settings →</a></div>}
  </>}
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
