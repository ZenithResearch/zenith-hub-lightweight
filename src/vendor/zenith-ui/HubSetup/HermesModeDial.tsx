"use client";
import {useRef,useState,type ReactNode,type RefObject} from "react";
export function HermesModeDial({compact,onInput,onMatrix,onActivate,buttonRef,available,loading,children,controls,matrixOpen}:{compact:boolean;onInput:()=>void;onMatrix?:()=>void;onActivate:()=>void;buttonRef?:RefObject<HTMLButtonElement|null>;available:boolean;loading:boolean;children?:ReactNode;controls:string;matrixOpen:boolean}){
 const [touchOpen,setTouchOpen]=useState(false),[suppressed,setSuppressed]=useState(false);
 const anchor=useRef<HTMLButtonElement>(null),pointer=useRef(""),input=useRef<HTMLButtonElement>(null),matrix=useRef<HTMLButtonElement>(null);
 return <div className={"zn-hermes-dial"+(touchOpen?" is-open":"")+(suppressed?" is-suppressed":"")} onPointerEnter={()=>setSuppressed(false)} onPointerLeave={()=>{setTouchOpen(false);setSuppressed(false);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setTouchOpen(false);setSuppressed(false);}}} onKeyDown={event=>{
  if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setTouchOpen(false);setSuppressed(true);anchor.current?.focus();}
  if(onMatrix&&["ArrowUp","ArrowLeft","ArrowDown","ArrowRight"].includes(event.key)){event.preventDefault();setSuppressed(false);setTouchOpen(true);const target=["ArrowUp","ArrowLeft"].includes(event.key)?matrix:input;requestAnimationFrame(()=>target.current?.focus());}
 }}>
  {onMatrix&&<div className="zn-hermes-dial__choices" role="group" aria-label="HUD views">
   <span className="zn-hermes-dial__arc" aria-hidden="true"/>
   <button ref={input} type="button" className="zn-hermes-dial__choice is-quick" onClick={()=>{setTouchOpen(false);setSuppressed(true);onInput();}}>Hermes</button>
   <button ref={matrix} type="button" className="zn-hermes-dial__choice is-chat" aria-label="Open Matrix chat" aria-expanded={matrixOpen} onClick={()=>{setTouchOpen(false);setSuppressed(true);onMatrix();}}>Matrix</button>
  </div>}
  <button ref={node=>{anchor.current=node;if(buttonRef)buttonRef.current=node;}} type="button" className={compact?"zn-hermes-hud__orb":"zn-hermes-hud__dot-control"} aria-label={matrixOpen?"Minimize Matrix chat":compact?"Open Hermes message input":"Minimize Hermes input"} aria-expanded={matrixOpen||!compact} aria-controls={matrixOpen?"zenith-matrix-chat":controls} aria-busy={loading} onPointerDown={event=>{pointer.current=event.pointerType;}} onClick={()=>{
   if(onMatrix&&pointer.current==="touch"&&!touchOpen){setSuppressed(false);setTouchOpen(true);return;}
   setTouchOpen(false);onActivate();
  }}>{children}<span aria-hidden="true" className={"zn-hermes-hud__dot"+(available?" is-connected":"")}/></button>
 </div>;
}
