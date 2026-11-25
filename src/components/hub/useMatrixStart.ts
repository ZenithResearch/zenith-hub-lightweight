"use client";
import {useRef,useState} from "react";
import type {MatrixStartDraft,MatrixStartKind,MatrixStartModel} from "@/vendor/zenith-ui/MatrixChat/MatrixChat";
type Context={key:string;instanceId:string;userId:string;deviceId:string;endpoint:string;reviewId?:string|null};
type Plan={id:string;action:string;args:Record<string,unknown>;effects:string[];instanceId:string;account:string;endpoint:string};
type State=MatrixStartModel&{key:string;active:boolean;review?:Plan|null};
const allowed=new Set(['start-dm','create-room','join-room']);
const empty:MatrixStartDraft={userId:'',name:'',invite:'',roomId:''};
const messages:Record<string,string>={matrix_review_pending:'A saved Matrix action is waiting in Settings.',matrix_busy:'Another Matrix check is running. Try again in a moment.',matrix_invalid_user:'Enter a full Matrix user ID, such as @name:example.org.',matrix_invalid_room:'Enter a full room ID or alias.',matrix_invalid_invitees:'Use at most 20 full Matrix user IDs.',matrix_direct_self_unsupported:'Choose another Matrix user.',matrix_review_expired:'This review expired. Go back and review the action again.',matrix_reconciliation_required:'A previous action needs checking in Matrix Settings before another can run.',matrix_direct_recovery_changed:'The retained conversation changed. Check its room and membership in Settings.',matrix_permission_denied:'The homeserver did not permit this action.',matrix_session_expired:'Sign in again through Matrix Settings.'};
const explain=(code:string)=>messages[code]||'This action could not be completed. Your existing conversations are retained; check Matrix Settings for details.';
export function useMatrixStart({context,csrf,onSnapshot,onRoom,onBusy}:{context:Context|null;csrf:string;onSnapshot:(snapshot:unknown)=>void;onRoom:(accountKey:string,roomId:string)=>void;onBusy:(busy:boolean)=>void}){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),current=useRef(context),inFlight=useRef(false);current.current=context;
 function patch(key:string,value:Partial<State>){setState(s=>s?.key===key?{...s,...value}:s);}
 async function request(body:Record<string,unknown>){const response=await fetch('/api/matrix',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zenith-csrf':csrf},body:JSON.stringify({schema:'zenith.hub-matrix-action.v1',...body}),signal:AbortSignal.timeout(90000)});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error),{code:value.error});return value;}
 function validateReview(value:{schema:string;plan:Plan},c:Context){const p=value?.plan;if(p&&!allowed.has(p.action))throw Object.assign(Error(),{code:'matrix_review_pending'});if(value?.schema!=='zenith.hub-matrix-review.v1'||!p||p.instanceId!==c.instanceId||p.account!==c.userId||p.endpoint!==c.endpoint||typeof p.id!=='string'||!Array.isArray(p.effects))throw Object.assign(Error(),{code:'matrix_review_changed'});return p;}
 function publish(value:any,c:Context){
  if(current.current?.key!==c.key)return;
  const instance=value?.instances?.find((i:any)=>i.instanceId===c.instanceId);
  if(value?.schema!=='zenith.hub-matrix.v1'||instance?.account?.userId!==c.userId||instance?.account?.deviceId!==c.deviceId||instance.endpoint!==c.endpoint)throw Object.assign(Error(),{code:'matrix_review_changed'});
  onSnapshot(value);
  return instance;
 }
 async function run(action:(c:Context)=>Promise<void>,uncertain=false){
  const c=current.current;if(!c||inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);patch(c.key,{error:''});
  try{await action(c);}catch(error){const code=(error as {code?:string}).code;
   patch(c.key,{...(code==='matrix_review_pending'?{phase:'blocked' as const}:{}),error:code?explain(code):'The response was interrupted. Check the result before trying again.',...(!code&&uncertain?{phase:'uncertain' as const}:{})});
  }finally{inFlight.current=false;setBusy(false);onBusy(false);}
 }
 async function resume(c:Context,id:string){const review=validateReview(await request({operation:'read-review',planId:id}),c);patch(c.key,{review,kind:review.action==='start-dm'?'dm':review.action==='join-room'?'join':'room',phase:'review'});}
 function open(){const c=current.current;if(!c)return;setState(s=>s?.key===c.key?{...s,active:true,error:''}:{key:c.key,active:true,kind:'dm',phase:'compose',draft:{...empty},busy:false,error:'',review:null});if(c.reviewId&&c.reviewId!==state?.review?.id)void run(selected=>resume(selected,c.reviewId!));}
 function outcome(value:any,c:Context,result:any){publish(value,c);if(current.current?.key!==c.key)return;
  if(result?.state==='complete'&&typeof result.result?.roomId==='string'&&/^![^\s:]+:[^\s]+$/.test(result.result.roomId)){patch(c.key,{active:false,review:null,phase:'compose'});onRoom(c.key,result.result.roomId);}
  else patch(c.key,{phase:'uncertain',error:result?.state==='partial'?'The room exists, but a later step needs checking. It will not be created again automatically.':result?.error?explain(result.error):'The result is not confirmed. Check it before repeating the action.'});
 }
 const review=(action:string,args:Record<string,unknown>)=>{const selected=current.current;if(selected)setState(s=>s?.key===selected.key?{...s,kind:action==='start-dm'?'dm':action==='join-room'?'join':'room',draft:action==='join-room'?{...s.draft,roomId:String(args.roomId||'')}:s.draft}:s);void run(async c=>{if(!allowed.has(action))return;const plan=validateReview(await request({operation:'review',instanceId:c.instanceId,action,args}),c);patch(c.key,{review:plan,phase:'review',kind:action==='start-dm'?'dm':action==='join-room'?'join':'room'});});};
 const apply=()=>{const plan=state?.review;if(!plan)return;void run(async c=>{const value=await request({operation:'apply',planId:plan.id});outcome(value,c,value.result);},true);};
 const check=()=>{const plan=state?.review;if(!plan)return;void run(async c=>{const response=await fetch('/api/matrix',{cache:'no-store',signal:AbortSignal.timeout(30000)}),value=await response.json();if(!response.ok)throw Error();const instance=publish(value,c),op=instance?.operations?.find((o:any)=>o.id===plan.id);outcome(value,c,op||{state:'unknown'});});};
 const cancel=()=>{const c=current.current;if(!c||busy)return;if(state?.review&&state.phase==='review'){void run(async selected=>{await request({operation:'cancel',planId:state.review!.id});patch(selected.key,{phase:'compose',review:null,error:''});});}else patch(c.key,{active:false,phase:'compose',review:null,error:''});};
 const model=state?.active&&state.key===context?.key?{...state,busy}:undefined;
 return {model,busy,open,review,apply,check,cancel,kind:(kind:MatrixStartKind)=>{if(context)patch(context.key,{kind,error:''});},draft:(field:keyof MatrixStartDraft,value:string)=>{if(context&&state)patch(context.key,{draft:{...state.draft,[field]:value}});}};
}
