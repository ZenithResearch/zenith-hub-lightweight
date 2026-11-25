"use client";
import {useId} from "react";
import {ResourceCanvas} from "../YourHub/YourHub.tsx";
import {HubNavigationLink,type HubNavigate} from "./HubNavigation.tsx";
import "./MainHub.css";
export type HubConversation={key:string;roomId:string;name:string;topic:string;encrypted:boolean;openHref:string};
export type HubConversationConnection={key:string;label:string;userId:string|null;state:"verified"|"partial"|"stale"|"sign-in-required"|"disabled"|"unavailable";message:string;settingsHref:string;rooms:HubConversation[];roomsComplete:boolean;invitations:number|null};
export type HubWorkSource={key:string;name:string;description:string;status:string;message:string;settingsHref:string;openHref:string|null};
export type MainHubModel={loading:boolean;warnings:string[];conversations:HubConversationConnection[];work:HubWorkSource[]};
export function MainHub({model,busy=false,selectedConversationKey,onSelectConversation,onNavigate,onRefresh}:{model:MainHubModel;busy?:boolean;selectedConversationKey?:string|null;onSelectConversation:(key:string)=>void;onNavigate?:HubNavigate;onRefresh:()=>void}){
 const conversationsId=useId(),workId=useId();
 const selected=model.conversations.flatMap(c=>c.rooms.map(room=>({connection:c,room}))).find(v=>v.room.key===selectedConversationKey);
 const knownAccounts=model.conversations.filter(c=>c.state==="verified"||c.state==="partial");
 return <ResourceCanvas paused={Boolean(selected)}><main id="hub-main" className="zn-main-hub">
  <h1 className="zn-your-hub__sr-only">Zenith Hub</h1>
  <div className="zn-main-hub__toolbar">
   <div className="zn-main-hub__identity">{knownAccounts.length===1?<><span className="zn-main-hub__live" aria-hidden="true"/><span title={knownAccounts[0].userId||undefined}>{knownAccounts[0].userId}</span></>:<span>{model.loading?"Reading your Hub…":knownAccounts.length>1?knownAccounts.length+" Matrix accounts connected":"Your connected workspace"}</span>}</div>
   <div className="zn-main-hub__controls">
    <button className="zn-main-hub__icon" type="button" aria-label="Refresh Hub" title="Refresh Hub" aria-busy={busy} disabled={busy} onClick={onRefresh}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg></button>
    <HubNavigationLink className="zn-main-hub__icon" href="/settings" onNavigate={onNavigate} aria-label="Settings & configuration" title="Settings & configuration"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9.5 3-.7 2.4-2 .9-2.3-.6-2 3.5L4.2 11v2l-1.7 1.8 2 3.5 2.3-.6 2 .9.7 2.4h5l.7-2.4 2-.9 2.3.6 2-3.5L19.8 13v-2l1.7-1.8-2-3.5-2.3.6-2-.9L14.5 3z"/><circle cx="12" cy="12" r="3.2"/></svg></HubNavigationLink>
   </div>
  </div>
  {model.warnings.map((warning,index)=><p className="zn-main-hub__notice" role="status" key={index}>{warning}</p>)}
  <div className="zn-main-hub__columns">
   <section className="zn-main-hub__panel" aria-labelledby={conversationsId}>
    <h2 id={conversationsId}>Conversations</h2><p className="zn-main-hub__intro">Your Matrix rooms and conversations.</p>
    {model.loading?<p role="status">Checking your saved connections…</p>:model.conversations.length===0?<div className="zn-main-hub__empty"><h3>Connect your conversations</h3><p>Connect a Matrix account to see your rooms here.</p><HubNavigationLink className="zn-main-hub__action" href="/settings?component=matrix" onNavigate={onNavigate}>Configure Matrix <span aria-hidden="true">→</span></HubNavigationLink></div>:model.conversations.map(connection=><div className="zn-main-hub__connection" key={connection.key}>
     <div className="zn-main-hub__connection-heading"><h3>{connection.label}</h3><HubNavigationLink href={connection.settingsHref} onNavigate={onNavigate} aria-label={"Configure "+connection.label}>Configure</HubNavigationLink></div>
     {connection.userId&&<p className="zn-main-hub__account">{connection.userId}</p>}
     {connection.message&&<p className="zn-main-hub__message" role="status">{connection.message}</p>}
     {connection.state==="verified"||connection.state==="partial"?<>
      {connection.rooms.length?<ul className="zn-main-hub__rooms">{connection.rooms.map(room=><li key={room.key}><button type="button" aria-pressed={room.key===selectedConversationKey} onClick={()=>onSelectConversation(room.key)}><span>{room.name}</span><small>{room.encrypted?"Encrypted":"Room"}<span aria-hidden="true"> →</span></small></button></li>)}</ul>:connection.roomsComplete?<p className="zn-main-hub__empty-message">No joined conversations yet. Join or create a room in Matrix settings.</p>:null}
      {connection.invitations!==null&&connection.invitations>0&&<HubNavigationLink className="zn-main-hub__invites" href={connection.settingsHref} onNavigate={onNavigate}>{connection.invitations} pending {connection.invitations===1?"invitation":"invitations"} — review in Settings</HubNavigationLink>}
     </>:<HubNavigationLink className="zn-main-hub__action" href={connection.settingsHref} onNavigate={onNavigate}>{connection.state==="sign-in-required"?"Sign in to Matrix":"Open Matrix settings"} <span aria-hidden="true">→</span></HubNavigationLink>}
    </div>)}
    {selected&&(selected.connection.state==="verified"||selected.connection.state==="partial")&&<section className="zn-main-hub__conversation" aria-label={selected.room.name+" conversation"}>
     <h3>{selected.room.name}</h3>{selected.room.topic&&<p>{selected.room.topic}</p>}
     <p>{selected.room.encrypted?"Encrypted messages stay in your Matrix client.":"Open this conversation in your Matrix client."} In-Hub messaging is not available yet.</p>
     <HubNavigationLink className="zn-main-hub__action" href={selected.room.openHref} target="_blank" rel="noreferrer">Open in Matrix client <span aria-hidden="true">↗</span></HubNavigationLink>
    </section>}
   </section>
   <section className="zn-main-hub__panel" aria-labelledby={workId}>
    <h2 id={workId}>Work</h2><p className="zn-main-hub__intro">Requests, cases and linked work from your work apps.</p>
    {model.loading?<p role="status">Checking your work connections…</p>:model.work.map(source=><article className="zn-main-hub__work-source" key={source.key}>
     <h3>{source.name}</h3><p>{source.description}</p><span className="zn-main-hub__status">{source.status}</span><p className="zn-main-hub__message">{source.message}</p>
     <div className="zn-main-hub__source-actions">{source.openHref&&<HubNavigationLink className="zn-main-hub__action" href={source.openHref} target="_blank" rel="noreferrer">Open service <span aria-hidden="true">↗</span></HubNavigationLink>}<HubNavigationLink href={source.settingsHref} onNavigate={onNavigate}>{source.openHref?"Connection settings":"Configure "+source.name} <span aria-hidden="true">→</span></HubNavigationLink></div>
    </article>)}
   </section>
  </div>
 </main></ResourceCanvas>;
}
