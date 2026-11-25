"use client";
export type MatrixStartKind="dm"|"room"|"join";
export type MatrixStartDraft={userId:string;name:string;invite:string;roomId:string};
export type MatrixStartModel={kind:MatrixStartKind;phase:"compose"|"review"|"uncertain"|"blocked";draft:MatrixStartDraft;busy:boolean;error:string;review?:{id:string;action:string;effects:string[];args:Record<string,unknown>}|null};
export function MatrixStart({model,onKind,onDraft,onReview,onApply,onCancel,onCheck,onConfigure}:{model:MatrixStartModel;onKind?:(kind:MatrixStartKind)=>void;onDraft?:(field:keyof MatrixStartDraft,value:string)=>void;onReview?:(action:string,args:Record<string,unknown>)=>void;onApply?:()=>void;onCancel?:()=>void;onCheck?:()=>void;onConfigure?:()=>void}){
 const titles={dm:"New message",room:"Create room",join:"Join room"},d=model.draft;
 return <section className="zn-matrix-start" aria-label="Start a Matrix conversation">
  <div className="zn-matrix-start__heading"><strong>{titles[model.kind]}</strong><button type="button" onClick={onCancel} disabled={model.busy} aria-label="Back to conversations">‹ Back</button></div>
  {model.error&&<p role="alert">{model.error}</p>}
  {model.phase==="blocked"?<><p>Finish the saved action in Matrix Settings before starting another conversation.</p><button onClick={onConfigure}>Open Matrix settings</button></>:model.phase==="uncertain"?<><p>The result needs checking. This action will not be repeated automatically.</p><button disabled={model.busy} onClick={onCheck}>{model.busy?"Checking…":"Check result"}</button></>:model.phase==="review"&&model.review?<>
   <ul>{model.review.effects.map(effect=><li key={effect}>{effect}</li>)}</ul>
   <dl>{Object.entries(model.review.args).filter(([key])=>!["acknowledgeEncryption","visibility","joinRule"].includes(key)).map(([key,value])=><div key={key}><dt>{key==="userId"?"To":key==="roomId"?"Room":key==="invite"?"Invite":key}</dt><dd>{Array.isArray(value)?value.join(", "):String(value)}</dd></div>)}</dl>
   <button disabled={model.busy} onClick={onApply}>{model.busy?"Working…":model.kind==="dm"?"Start conversation":titles[model.kind]}</button>
  </>:<>
   <div className="zn-matrix-start__kinds" aria-label="Conversation action">{(["dm","room","join"] as const).map(kind=><button key={kind} type="button" aria-pressed={model.kind===kind} disabled={model.busy} onClick={()=>onKind?.(kind)}>{titles[kind]}</button>)}</div>
   <form onSubmit={event=>{event.preventDefault();if(model.busy)return;
    if(model.kind==="dm")onReview?.("start-dm",{userId:d.userId.trim(),acknowledgeEncryption:true});
    else if(model.kind==="join")onReview?.("join-room",{roomId:d.roomId.trim()});
    else onReview?.("create-room",{name:d.name.trim(),visibility:"private",joinRule:"invite",encryption:true,acknowledgeEncryption:true,...(d.invite.trim()?{invite:[...new Set(d.invite.split(/[,\n]/).map(s=>s.trim()).filter(Boolean))]}:{})});
   }}>
    {model.kind==="dm"?<label>Matrix user ID<input autoComplete="off" placeholder="@name:example.org" required maxLength={512} value={d.userId} onChange={e=>onDraft?.("userId",e.target.value)} disabled={model.busy}/></label>:model.kind==="join"?<label>Room ID or alias<input placeholder="#room:example.org" required maxLength={512} value={d.roomId} onChange={e=>onDraft?.("roomId",e.target.value)} disabled={model.busy}/></label>:<>
     <label>Room name<input required maxLength={200} value={d.name} onChange={e=>onDraft?.("name",e.target.value)} disabled={model.busy}/></label>
     <label>Invite people (optional)<textarea rows={2} maxLength={10400} placeholder="@name:example.org, @friend:example.org" value={d.invite} onChange={e=>onDraft?.("invite",e.target.value)} disabled={model.busy}/><small>Up to 20 full Matrix IDs, separated by commas or new lines.</small></label>
    </>}
    <p>{model.kind==="join"?"Join an existing room or accept its invitation using this account.":"New chats are private and encrypted. Encryption is permanent. Invitations are sent only after you review and confirm."}</p>
    <button type="submit" disabled={model.busy}>{model.busy?"Preparing…":"Review"}</button>
   </form>
  </>}
 </section>;
}
