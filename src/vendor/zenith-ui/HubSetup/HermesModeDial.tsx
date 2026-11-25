"use client";
import {useEffect,useRef,useState,type CSSProperties,type ReactNode,type RefObject} from "react";

export type MatrixHoverHandlers={onEnter:()=>void;onLeave:()=>void};
export type HermesQuickTarget={id:string;label:string;color:string};
export type HermesQuickOptions={quickTargets?:HermesQuickTarget[];activeQuickId?:string;onSelectQuick?:(id:string)=>void};
type DialProps=HermesQuickOptions&{
  onPreviewMatrix?:()=>void;matrixHover?:MatrixHoverHandlers;compact:boolean;
  onInput:()=>void;onMatrix?:()=>void;onActivate:()=>void;
  buttonRef?:RefObject<HTMLButtonElement|null>;available:boolean;loading:boolean;
  children?:ReactNode;controls:string;matrixOpen:boolean;
};
const point=(center:number,radius:number,degrees:number)=>{
  const radians=degrees*Math.PI/180;
  return [center+radius*Math.cos(radians),center+radius*Math.sin(radians)];
};
function segment(center:number,inner:number,outer:number,start:number,end:number){
  const a=point(center,outer,start),b=point(center,outer,end),c=point(center,inner,end),d=point(center,inner,start);
  return `M${a} A${outer},${outer} 0 0 1 ${b} L${c} A${inner},${inner} 0 0 0 ${d} Z`;
}

/** A connected radial collar. Receiver identity and Matrix ownership stay with the app. */
export function HermesModeDial({onPreviewMatrix,matrixHover,quickTargets,activeQuickId,onSelectQuick,compact,onInput,onMatrix,onActivate,buttonRef,available,loading,children,controls,matrixOpen}:DialProps){
  const [hovered,setHovered]=useState(false),[keyboard,setKeyboard]=useState(false),[touchOpen,setTouchOpen]=useState(false),[suppressed,setSuppressed]=useState(false);
  const root=useRef<HTMLDivElement>(null),anchor=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),inbox=useRef<HTMLButtonElement>(null);
  const pointer=useRef(""),leaveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),previewTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const preview=useRef(onPreviewMatrix);preview.current=onPreviewMatrix;
  const open=!suppressed&&(hovered||keyboard||touchOpen);
  const targets=quickTargets?.length?quickTargets:[{id:"default",label:"Hermes",color:"#75dfc2"}];
  const center=compact?24:16,orbit=center+10+Math.max(0,targets.length-4)*3,outer=orbit+6,inner=orbit-5,size=outer*2;
  const inboxPoint=point(center,orbit,270);
  function cancelLeave(){if(leaveTimer.current!==null){clearTimeout(leaveTimer.current);leaveTimer.current=null;}}
  function cancelPreview(){if(previewTimer.current!==null){clearTimeout(previewTimer.current);previewTimer.current=null;}}
  useEffect(()=>{
    // Connection discovery may mount this control underneath a stationary pointer.
    if(window.matchMedia("(hover: hover)").matches&&root.current?.matches(":hover"))setHovered(true);
    return()=>{cancelLeave();cancelPreview();};
  },[]);
  function dismiss(){cancelLeave();cancelPreview();setSuppressed(true);setHovered(false);setKeyboard(false);setTouchOpen(false);}
  function enter(){cancelLeave();setHovered(true);setSuppressed(false);matrixHover?.onEnter();}
  function leave(){
    cancelLeave();cancelPreview();matrixHover?.onLeave();
    // Cross the small radial gaps without a large invisible rectangular hover area.
    leaveTimer.current=setTimeout(()=>{leaveTimer.current=null;setHovered(false);setTouchOpen(false);},140);
  }
  function previewInbox(){cancelPreview();previewTimer.current=setTimeout(()=>{previewTimer.current=null;preview.current?.();},120);}
  function moveFocus(key:string){
    cancelLeave();setSuppressed(false);setKeyboard(true);
    const buttons=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button")||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const backwards=key==="ArrowUp"||key==="ArrowLeft";
    const next=key==="Home"?buttons[0]:key==="End"?buttons.at(-1):index<0?(backwards?inbox.current:buttons[0]):buttons[(index+(backwards?-1:1)+buttons.length)%buttons.length];
    requestAnimationFrame(()=>next?.focus());
  }
  return <div ref={root} className={"zn-hermes-dial"+(open?" is-open":"")+(suppressed?" is-suppressed":"")} data-compact={compact}
    onPointerEnter={event=>{if(event.pointerType!=="touch")enter();}}
    onPointerLeave={event=>{if(event.pointerType!=="touch")leave();}}
    onPointerDown={()=>setKeyboard(false)}
    onFocusCapture={event=>{if(event.target.matches(":focus-visible")&&!suppressed)setKeyboard(true);}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setKeyboard(false);matrixHover?.onLeave();}}}
    onKeyDown={event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();dismiss();matrixHover?.onLeave();requestAnimationFrame(()=>anchor.current?.focus());}
      else if(onMatrix&&["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();moveFocus(event.key);}
    }}>
    {onMatrix&&<div ref={menu} className="zn-hermes-dial__menu" aria-hidden={!open} role="group" aria-label="Chat controls">
      <svg className="zn-hermes-dial__collar" style={{left:center-outer,top:center-outer,width:size,height:size}} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <path className="zn-hermes-dial__rail" d={segment(outer,inner,outer,105,246)}/>
        <path className={"zn-hermes-dial__inbox-segment"+(matrixOpen?" is-active":"")} d={segment(outer,inner,outer,250,292)}/>
      </svg>
      {targets.map((target,index)=>{
        const angle=targets.length===1?180:120+index*108/(targets.length-1),[x,y]=point(center,orbit,angle);
        const style={left:x,top:y,"--dial-color":target.color} as CSSProperties;
        return <button key={target.id} type="button" tabIndex={open?0:-1} className="zn-hermes-dial__choice zn-hermes-dial__receiver" style={style}
          title={target.label} aria-label={"Message "+target.label} aria-pressed={activeQuickId===target.id}
          onClick={()=>{dismiss();onSelectQuick?.(target.id);onInput();}}><span aria-hidden="true"/></button>;
      })}
      <button ref={inbox} type="button" tabIndex={open?0:-1} className="zn-hermes-dial__choice zn-hermes-dial__inbox" style={{left:inboxPoint[0],top:inboxPoint[1]}}
        aria-label="Open Matrix inbox" aria-expanded={matrixOpen} aria-controls="zenith-matrix-chat" title="Inbox"
        onPointerEnter={event=>{if(event.pointerType!=="touch")previewInbox();}}
        onPointerLeave={event=>{cancelPreview();if(!root.current?.contains(event.relatedTarget as Node|null))matrixHover?.onLeave();}}
        onFocus={()=>{cancelPreview();preview.current?.();}}
        onBlur={event=>{cancelPreview();if(!root.current?.contains(event.relatedTarget as Node|null))matrixHover?.onLeave();}}
        onClick={()=>{dismiss();onMatrix();}}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12l2 7v4H2v-4l2-7Zm-2 7h5l1.5 2h3l1.5-2h5"/></svg>
      </button>
    </div>}
    <button ref={node=>{anchor.current=node;if(buttonRef)buttonRef.current=node;}} type="button"
      className={compact?"zn-hermes-hud__orb":"zn-hermes-hud__dot-control"}
      aria-label={matrixOpen?"Minimize Matrix chat":compact?"Open Hermes message input":"Minimize Hermes input"}
      aria-expanded={matrixOpen||!compact} aria-controls={matrixOpen?"zenith-matrix-chat":controls} aria-busy={loading}
      onPointerDown={event=>{pointer.current=event.pointerType;}}
      onClick={event=>{
        if(onMatrix&&pointer.current==="touch"&&event.detail!==0&&!touchOpen){setSuppressed(false);setTouchOpen(true);return;}
        dismiss();onActivate();
      }}>{children}<span aria-hidden="true" className={"zn-hermes-hud__dot"+(available?" is-connected":"")}/></button>
  </div>;
}
