"use client";
import {useRef,useState,type ReactNode,type RefObject} from "react";
export type HermesInputMode="quick"|"chat";
export function HermesModeDial({mode,compact,onMode,onActivate,buttonRef,available,loading,children,controls}:{mode:HermesInputMode;compact:boolean;onMode:(mode:HermesInputMode)=>void;onActivate:()=>void;buttonRef?:RefObject<HTMLButtonElement|null>;available:boolean;loading:boolean;children?:ReactNode;controls:string}){
 const [touchOpen,setTouchOpen]=useState(false),[suppressed,setSuppressed]=useState(false);
 const anchor=useRef<HTMLButtonElement>(null),pointer=useRef(""),quick=useRef<HTMLButtonElement>(null),chat=useRef<HTMLButtonElement>(null);
 return <div className={"zn-hermes-dial"+(touchOpen?" is-open":"")+(suppressed?" is-suppressed":"")} onPointerEnter={()=>setSuppressed(false)} onPointerLeave={()=>{setTouchOpen(false);setSuppressed(false);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setTouchOpen(false);setSuppressed(false);}}} onKeyDown={event=>{
  if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setTouchOpen(false);setSuppressed(true);anchor.current?.focus();}
  if(event.key==="ArrowUp"||event.key==="ArrowLeft"){event.preventDefault();setSuppressed(false);setTouchOpen(true);chat.current?.focus();}
  if(event.key==="ArrowDown"||event.key==="ArrowRight"){event.preventDefault();setSuppressed(false);setTouchOpen(true);quick.current?.focus();}
 }}>
  <div className="zn-hermes-dial__choices" role="group" aria-label="Hermes input mode">
   <span className="zn-hermes-dial__arc" aria-hidden="true"/>
   {(["quick","chat"] as const).map(option=><button key={option} ref={option==="quick"?quick:chat} type="button" className={"zn-hermes-dial__choice is-"+option} aria-label={option==="chat"?"Switch Hermes to chat":"Switch Hermes to quick input"} aria-pressed={mode===option} onClick={()=>{setTouchOpen(false);setSuppressed(true);onMode(option);}}>{option==="chat"?"Chat":"Quick"}</button>)}
  </div>
  <button ref={node=>{anchor.current=node;if(buttonRef)buttonRef.current=node;}} type="button" className={compact?"zn-hermes-hud__orb":"zn-hermes-hud__dot-control"} aria-label={compact?(mode==="chat"?"Open Hermes chat":"Open Hermes message input"):"Minimize Hermes input"} aria-expanded={!compact} aria-controls={controls} aria-busy={loading} onPointerDown={event=>{pointer.current=event.pointerType;}} onClick={()=>{
   if(pointer.current==="touch"&&!touchOpen){setSuppressed(false);setTouchOpen(true);return;}
   setTouchOpen(false);onActivate();
  }}><span className="zn-hermes-hud__sr-only">Use arrow keys for input modes.</span>{children}<span aria-hidden="true" className={"zn-hermes-hud__dot"+(available?" is-connected":"")}/></button>
 </div>;
}
