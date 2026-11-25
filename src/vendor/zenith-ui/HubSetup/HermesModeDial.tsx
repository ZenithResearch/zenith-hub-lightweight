"use client";
import {useEffect,useRef,useState,type CSSProperties,type ReactNode,type RefObject} from "react";
export type MatrixHoverHandlers={onEnter:()=>void;onLeave:()=>void};
export type HermesQuickTarget={id:string;label:string;color:string};
export type HermesQuickOptions={quickTargets?:HermesQuickTarget[];activeQuickId?:string;onSelectQuick?:(id:string)=>void};
export function HermesModeDial({onPreviewMatrix,matrixHover,quickTargets,activeQuickId,onSelectQuick,compact,onInput,onMatrix,onActivate,buttonRef,available,loading,children,controls,matrixOpen}:HermesQuickOptions&{onPreviewMatrix?:()=>void;matrixHover?:MatrixHoverHandlers;compact:boolean;onInput:()=>void;onMatrix?:()=>void;onActivate:()=>void;buttonRef?:RefObject<HTMLButtonElement|null>;available:boolean;loading:boolean;children?:ReactNode;controls:string;matrixOpen:boolean}){
 const [touchOpen,setTouchOpen]=useState(false),[suppressed,setSuppressed]=useState(false);
 const intent=useRef<ReturnType<typeof setTimeout>|null>(null);
 const preview=useRef(onPreviewMatrix);preview.current=onPreviewMatrix;
 function cancelIntent(){if(intent.current!==null){clearTimeout(intent.current);intent.current=null;}}
 useEffect(()=>cancelIntent,[]);
 const anchor=useRef<HTMLButtonElement>(null),pointer=useRef(""),choices=useRef<HTMLDivElement>(null),matrix=useRef<HTMLButtonElement>(null);
 // A fallback keeps existing callers working; extra dots always come from actual receivers.
 const targets=quickTargets?.length?quickTargets:[{id:"default",label:"Hermes",color:"#75dfc2"}];
 const radius=Math.max(34,targets.length*6);
 return <div className={"zn-hermes-dial"+(touchOpen?" is-open":"")+(suppressed?" is-suppressed":"")} onPointerEnter={()=>{setSuppressed(false);matrixHover?.onEnter();}} onPointerLeave={()=>{setTouchOpen(false);setSuppressed(false);cancelIntent();matrixHover?.onLeave();}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setTouchOpen(false);setSuppressed(false);matrixHover?.onLeave();}}} onKeyDown={event=>{
  if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setTouchOpen(false);setSuppressed(true);cancelIntent();matrixHover?.onLeave();anchor.current?.focus();}
  if(onMatrix&&["ArrowUp","ArrowLeft","ArrowDown","ArrowRight"].includes(event.key)){
   event.preventDefault();setSuppressed(false);setTouchOpen(true);
   const buttons=Array.from(choices.current?.querySelectorAll<HTMLButtonElement>("button")||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
   const previous=["ArrowUp","ArrowLeft"].includes(event.key);
   const target=index<0?(previous?matrix.current:buttons[0]):buttons[(index+(previous?-1:1)+buttons.length)%buttons.length];
   requestAnimationFrame(()=>target?.focus());
  }
 }}>
  {onMatrix&&<div ref={choices} className="zn-hermes-dial__choices" role="group" aria-label="HUD views">
   <svg className="zn-hermes-dial__arc" viewBox="0 0 80 80" aria-hidden="true"><path d="M40 6 A34 34 0 1 0 64 64"/></svg>
   {targets.map((target,index)=>{
    const angle=(targets.length===1?180:120+index*105/(targets.length-1))*Math.PI/180;
    const style={"--dial-x":(24+Math.cos(angle)*radius)+"px","--dial-y":(24+Math.sin(angle)*radius)+"px","--dial-color":target.color} as CSSProperties;
    return <button key={target.id} type="button" style={style} className="zn-hermes-dial__choice is-quick" aria-label={"Message "+target.label} title={target.label} aria-pressed={activeQuickId===target.id}
     onClick={()=>{setTouchOpen(false);setSuppressed(true);onSelectQuick?.(target.id);onInput();}}><span aria-hidden="true"/></button>;
   })}
   <button ref={matrix} type="button" className="zn-hermes-dial__choice is-chat" aria-label="Open Matrix inbox" title="Matrix inbox" aria-expanded={matrixOpen}
     onPointerEnter={event=>{if(event.pointerType!=="touch"&&preview.current){cancelIntent();intent.current=setTimeout(()=>{intent.current=null;preview.current?.();},120);}}}
     onPointerLeave={()=>{cancelIntent();matrixHover?.onLeave();}}
     onFocus={()=>preview.current?.()}
     onBlur={()=>{cancelIntent();matrixHover?.onLeave();}}
     onClick={()=>{setTouchOpen(false);setSuppressed(true);onMatrix();}}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h12l2 8v4H2v-4l2-8Zm-2 8h5l1.5 2h3l1.5-2h5"/></svg>
   </button>
  </div>}
  <button ref={node=>{anchor.current=node;if(buttonRef)buttonRef.current=node;}} type="button" className={compact?"zn-hermes-hud__orb":"zn-hermes-hud__dot-control"} aria-label={matrixOpen?"Minimize Matrix chat":compact?"Open Hermes message input":"Minimize Hermes input"} aria-expanded={matrixOpen||!compact} aria-controls={matrixOpen?"zenith-matrix-chat":controls} aria-busy={loading} onPointerDown={event=>{pointer.current=event.pointerType;}} onClick={()=>{
   if(onMatrix&&pointer.current==="touch"&&!touchOpen){setSuppressed(false);setTouchOpen(true);return;}
   setTouchOpen(false);onActivate();
  }}>{children}<span aria-hidden="true" className={"zn-hermes-hud__dot"+(available?" is-connected":"")}/></button>
 </div>;
}
