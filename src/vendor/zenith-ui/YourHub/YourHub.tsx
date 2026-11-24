"use client";
import React,{useEffect,useId,useRef,type ReactNode} from 'react';
import {ZenithCloudScene} from '../HubSetup/ZenithCloudScene.tsx';
import './YourHub.css';
export type HubResource = {key:string;label:string;purpose:string;componentId:string;status:string;managed:boolean;mode:string;observedAt?:string|null;endpoint?:string|null;actions:string[];enabled:boolean;stale?:boolean};
export function YourHub({resources,onSelect,onRefresh,busy=false,refreshing=false,selectedKey,children,notices,catalog=[],onChoose,flowContent}: {
 resources:HubResource[];onSelect:(key:string)=>void;onRefresh:()=>void;busy?:boolean;refreshing?:boolean;
 catalog?:{id:string;label:string;description:string}[];onChoose?:(id:string)=>void;flowContent?:ReactNode;
 selectedKey?:string;children?:ReactNode;notices?:ReactNode;
}) {
 const entries=resources;
 const available=catalog.filter(c=>!resources.some(r=>r.componentId===c.id));
 const configuredId=useId(),availableId=useId();
 return <ResourceCanvas paused={Boolean(flowContent)||Boolean(selectedKey)}>
  <main id="hub-main"><h1 className="zn-your-hub__sr-only">Apps &amp; services</h1>
   {notices}{flowContent}
   <div className="zn-your-hub__toolbar"><div className="zn-your-hub__count">Apps &amp; services</div><button className="zn-your-hub__refresh" type="button" aria-label="Refresh apps and services" title="Refresh apps and services" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg></button></div>
   <div className={selectedKey?'zn-your-hub__workspace has-detail':'zn-your-hub__workspace'}>
    <div className="zn-your-hub__groups">
     <section aria-labelledby={configuredId}>
      <h2 className="zn-your-hub__section-title" id={configuredId}>Configured instances <span>{entries.length}</span></h2>
      {entries.length?<div className="zn-your-hub__cards">{entries.map(r=><ResourceCard key={r.key} resource={r} selected={r.key===selectedKey} onSelect={()=>onSelect(r.key)}/>)}</div>:<p className="zn-your-hub__section-empty">No configured instances yet. Choose an available app below to get started.</p>}
     </section>
     <section aria-labelledby={availableId}>
      <h2 className="zn-your-hub__section-title" id={availableId}>Available apps <span>{available.length}</span></h2>
      {available.length?<div className="zn-your-hub__cards">{available.map(c=><button key={'catalog:'+c.id} className="zn-your-hub__card is-available" disabled={busy} onClick={()=>onChoose?.(c.id)}><h3>{c.label}</h3><p>{c.description}</p><span className="zn-your-hub__card-foot"><span className="zn-your-hub__card-action">Add <span aria-hidden="true">+</span></span></span></button>)}</div>:<p className="zn-your-hub__section-empty">No additional apps in the current catalog. Select a configured instance to add another.</p>}
     </section>
    </div>{children}
   </div>
   <footer className="zn-your-hub__footer">Connect or install apps and services here. Their data stays with the service that owns it.</footer>
  </main>
 </ResourceCanvas>;
}
function ResourceCard({resource:r,selected,onSelect}:{resource:HubResource;selected:boolean;onSelect:()=>void}) {
 const ready=['Ready','Ready to read','Guide available','API reachable','Installed'].includes(r.status);
 return <button className={'zn-your-hub__card'+(selected?' is-selected':'')} onClick={onSelect} aria-pressed={selected}><h3>{r.label}</h3><p>{r.purpose}</p><span className="zn-your-hub__card-foot"><span className="zn-your-hub__card-status"><span className={'zn-your-hub__dot'+(ready?' is-ready':'')}/>{r.status}</span><span className="zn-your-hub__card-action">Details <span aria-hidden="true">→</span></span></span></button>;
}
export function ResourceDetail({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
 return <aside className="zn-your-hub__detail" aria-label={title+' details'}><div className="zn-your-hub__detail-heading"><h2>{title}</h2><button onClick={onClose} aria-label="Close instance details">×</button></div>{children}</aside>;
}
export function ResourceDialog({title,eyebrow,onClose,onGuideHost,children}:{title:string;eyebrow?:string;onClose:()=>void;onGuideHost?:(host:HTMLDivElement|null)=>void;children:ReactNode}) {
 const dialog=useRef<HTMLDialogElement>(null),host=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null),titleId=useId(),guide=useRef(onGuideHost);guide.current=onGuideHost;
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null;dialog.current?.showModal();close.current?.focus();guide.current?.(host.current);return()=>{guide.current?.(null);dialog.current?.close();if(prior?.isConnected)prior.focus();};},[]);
 return <dialog ref={dialog} className="zn-resource-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}}><div className="zn-resource-dialog__heading"><div>{eyebrow&&<p className="zn-your-hub__eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2></div><button ref={close} type="button" onClick={onClose} aria-label="Close app setup">×</button></div>{children}<div ref={host} data-hermes-chat/></dialog>;
}

/** An on-page flow: the gallery and the global guide remain available. */
export function ResourceFlow({title,eyebrow,onClose,children}:{title:string;eyebrow?:string;onClose:()=>void;children:ReactNode}) {
 const section=useRef<HTMLElement>(null),titleId=useId();
 useEffect(()=>{section.current?.scrollIntoView({block:'start'});section.current?.focus({preventScroll:true});},[]);
 return <section ref={section} tabIndex={-1} className="zn-resource-dialog zn-resource-flow" aria-labelledby={titleId}><div className="zn-resource-dialog__heading"><div>{eyebrow&&<p className="zn-your-hub__eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close app setup">×</button></div>{children}</section>;
}

/** Shared welcome artwork, framed as a background for readable resource content. */
export function ResourceCanvas({children,paused=false}:{children:ReactNode;paused?:boolean}) {
 return <div className="zn-your-hub"><div className="zn-your-hub__sky" aria-hidden="true"><ZenithCloudScene paused={paused}/></div>{children}</div>;
}
