/** Generic Matrix setup. All writes are reviewed; remote authority is never inferred from reachability. */
import {serviceMonitor} from '../hub/monitoring.mjs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {operatorCsrf} from '../operator-session.mjs';
import {stateStore,readPrivate} from './state.mjs';
import {check,digest} from './catalog.mjs';
import {endpoint} from './network.mjs';
import {serviceEndpoint} from './connections.mjs';
import {matrixClient} from './matrix-client.mjs';
import {saveMatrixSession,readMatrixSession} from './matrix-session.mjs';
import {validateMatrixAction,matrixActionEffects} from './matrix-contract.mjs';
import {runOwned} from './adapters.mjs';
import {verifyMatrixListener} from './matrix-management.mjs';
const closed=(v,required,optional=[])=>check(v,v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>[...required,...optional].includes(k)),'matrix_invalid_action',400);
const bound=i=>digest({endpoint:serviceEndpoint(i),enabled:i.enabled!==false,mode:i.mode,root:i.root||null,serverName:i.config?.serverName||null,configured:i.configured??null,account:i.matrix?.account||null,version:i.matrix?.version||0});
/** Composite snapshots may finish late; retain only evidence that is still fresh. */
export function completedRoomView(view,now){
 const fresh=at=>{const age=now-Date.parse(at);return Number.isFinite(age)&&age>=-5000&&age<=30000;};
 const expired=(view.rooms||[]).filter(r=>!fresh(r.observedAt));
 view.rooms=(view.rooms||[]).filter(r=>fresh(r.observedAt));
 if(expired.length){view.roomsComplete=false;view.failures=[...(view.failures||[]),...expired.map(r=>({roomId:r.roomId,error:'matrix_room_evidence_expired'}))];}
 if(!fresh(view.directObservedAt)){view.directState='unverified';view.rooms=view.rooms.map(r=>({...r,directWith:[]}));}
 if(!fresh(view.invitationObservedAt)){view.invitationState='unverified';view.invitations=[];}
 view.observedAt=new Date(now).toISOString();return view;
}
export function createMatrixController({env=process.env,root=env.ZENITH_HUB_SETUP_DIR,store=stateStore(root),clientFactory=matrixClient,clock=Date.now,bootstrapSecret,run=runOwned}={}){
 const origin=env.ZENITH_OPERATOR_ORIGIN||'http://127.0.0.1:4208',u=endpoint(origin),csrf=operatorCsrf('matrix',env);
 const driverDigest=async()=>digest(await Promise.all(['matrix-controller.mjs','matrix-direct.mjs','matrix-client.mjs','matrix-contract.mjs','matrix-session.mjs','matrix-management.mjs','network.mjs','../../../profiles/setup/matrix.schema.json'].map(async f=>digest(await readFile(path.join(process.cwd(),'src/lib/setup',f))))));
 let busy=false;
 const options={allowPrivateHosts:(env.ZENITH_SETUP_PRIVATE_HOSTS||'').split(',').filter(Boolean)};
 function admit(r,write=false){
  check(env,env.ZENITH_LOCAL_OPERATOR==='1'&&env.ZENITH_GUIDED_SETUP==='1','matrix_setup_disabled',403);
  check(r,u.protocol==='http:'&&u.hostname==='127.0.0.1'&&new URL(r.url).origin===origin&&r.headers.get('host')===u.host&&(!r.headers.get('origin')||r.headers.get('origin')===origin)&&(!r.headers.get('sec-fetch-site')||['same-origin','none'].includes(r.headers.get('sec-fetch-site'))),'wrong_origin',403);
  if(write)check(r,r.headers.get('origin')===origin&&r.headers.get('content-type')==='application/json'&&r.headers.get('x-zenith-csrf')===csrf,'cross_site_action',403);
 }
 const instance=(s,id)=>check(s.instances.find(i=>i.instanceId===id&&i.componentId==='matrix'),s.instances.some(i=>i.instanceId===id&&i.componentId==='matrix'),'matrix_instance_missing',404);
 const api=async (i,monitor)=>{const session=await readMatrixSession(root,i);return clientFactory(serviceEndpoint(i),{...options,token:session?.token,monitor});};
 async function update(id,fn){return store.write(s=>{const i=instance(s,id);const result=fn(i);if(i.matrix)i.matrix.schema='zenith.hub-matrix-binding.v1';return result;});}
 async function localSecret(i){
  check(i,i.mode==='install'&&i.root===path.join(root,'instances',i.instanceId)&&i.configured===true,'matrix_local_management_required',403);
  if(bootstrapSecret)return bootstrapSecret(i);
  const receipt=JSON.parse(await readPrivate(path.join(i.root,'receipt.json'))),intent=JSON.parse(await readPrivate(path.join(i.root,'config/matrix-identity.json')));
  check(i,receipt.instanceId===i.instanceId&&receipt.componentId==='matrix'&&receipt.configured&&intent.serverName===i.config.serverName&&intent.root===i.root,'matrix_local_management_unverified',403);
  await verifyMatrixListener(i,{run});
  const output=await run(path.join(i.root,'venv/bin/python'),['-I','-c','import yaml,sys; print(yaml.safe_load(open(sys.argv[1]))["registration_shared_secret"])',path.join(i.root,'config/homeserver.yaml')],{timeout:10000});
  check(output,typeof output==='string'&&output.trim().length>=16,'matrix_bootstrap_unavailable');return output.trim();
 }
 async function refresh(id){
  const i=instance(await store.read(),id);check(i,i.enabled!==false,'matrix_connection_disabled');
  const base=serviceEndpoint(i),at=new Date(clock()).toISOString();
  let view={endpoint:base,observedAt:at,apiAvailable:false,authentication:'unverified',rooms:[],invitations:[],roomsComplete:false};
  try{
   const monitor=serviceMonitor(env,'setup:'+i.instanceId);
   const client=await api(i,monitor),discovery=await client.discover({allowPartialMetadata:i.matrix?.account?.endpoint===base});Object.assign(view,discovery,{apiAvailable:true,authentication:'sign-in-required'});
   if(i.matrix?.account?.endpoint===base){
    try{
     const who=await client.whoami();check(who,who.userId===i.matrix.account.userId,'matrix_account_changed');
     Object.assign(view,{authentication:'authenticated',account:who,credentialRef:i.matrix.account.credentialRef});const accountAt=clock();
     try{const rooms=await monitor('Room inventory',()=>client.rooms(who.userId), r=>r.complete?null:'Incomplete room evidence');Object.assign(view,rooms,{roomsComplete:rooms.complete});}
     catch(e){view.error=e.code||'matrix_rooms_unverified';view.roomsComplete=false;}
     if(clock()-accountAt>10000){const finalWho=await client.whoami();check(finalWho,finalWho.userId===i.matrix.account.userId&&finalWho.deviceId===who.deviceId,'matrix_account_changed');view.account=finalWho;}
     completedRoomView(view,clock());
    }catch(e){view.authentication=e.code==='matrix_session_expired'?'expired':e.code==='matrix_permission_denied'?'permission-denied':'unverified';view.error=e.code||'matrix_account_unverified';}
   }
  }catch(e){view.error=e.code||'matrix_api_unavailable';}
  await update(id,current=>{check(current,bound(current)===bound(i),'matrix_binding_changed');current.matrix={...current.matrix,view};});
  return view;
 }
 function publicInstance(i){
  const m=i.matrix||{},v=m.view,bindingValid=v?.endpoint===serviceEndpoint(i)&&(!v.credentialRef||v.credentialRef===m.account?.credentialRef),fresh=bindingValid&&clock()-Date.parse(v.observedAt)<=30000;
  return {instanceId:i.instanceId,label:i.config?.label||'Matrix',endpoint:serviceEndpoint(i),mode:i.mode,enabled:i.enabled!==false,installed:i.installed??null,configured:i.configured??null,running:i.running??null,management:i.mode==='install'?'hub-managed':'external',serverName:i.config?.serverName||null,account:m.account?{userId:m.account.userId,deviceId:m.account.deviceId,externalSession:m.account.externalSession,endpoint:m.account.endpoint}:null,selected:m.selected||null,view:bindingValid?{...v,credentialRef:undefined}:null,evidence:fresh?'fresh':'stale',reviewId:m.reviewId||null,operations:(m.operations||[]).map(o=>({...o,state:o.state==='applying'&&!busy?'unknown':o.state})),encryptedMessaging:'external-client-required'};
 }
 async function snapshot(){const s=await store.read();return {schema:'zenith.hub-matrix.v1',csrf,busy,instances:s.instances.filter(i=>i.componentId==='matrix').map(publicInstance)};}
 async function perform(plan,secret){
  const initial=instance(await store.read(),plan.instanceId);
  check(initial,bound(initial)===plan.binding,'matrix_review_changed');
  check(initial,initial.enabled!==false,'matrix_connection_disabled');
  const old=initial.matrix?.operations||[],prior=old.find(o=>o.id===plan.id);
  if(prior)return prior; // At-most-once submission, including after a lost response/restart.
  check(old,!old.some(o=>['applying','partial','unknown'].includes(o.state))||plan.action==='acknowledge-outcome','matrix_reconciliation_required');
  const client=await api(initial),at=new Date(clock()).toISOString();
  await update(plan.instanceId,i=>{check(i,bound(i)===plan.binding,'matrix_review_changed');i.matrix={...i.matrix,reviewId:null,operations:[{id:plan.id,action:plan.action,args:plan.args,binding:plan.binding,state:'applying',observedAt:at,completed:[],result:{}},...old].slice(0,30)};});
  async function checkpoint(value){await update(plan.instanceId,i=>{Object.assign(i.matrix.operations.find(o=>o.id===plan.id),value);});}
  let result;
  try{
   if(['login','bootstrap'].includes(plan.action)){
    check(secret,typeof secret==='string'&&secret.length>0&&secret.length<=8192&&!secret.includes('\0'),'matrix_credential_required',400);
    const account=plan.action==='login'?await client.login(plan.args.method,plan.args.username,secret):await client.bootstrap({...plan.args,password:secret,sharedSecret:await localSecret(initial)});
    const privateSession={token:account.token,userId:account.userId,deviceId:account.deviceId,endpoint:serviceEndpoint(initial)},credentialRef=await saveMatrixSession(root,privateSession);
    await update(plan.instanceId,i=>{check(i,bound(i)===plan.binding,'matrix_binding_changed');i.matrix.account={credentialRef,credentialDigest:digest(privateSession),userId:account.userId,deviceId:account.deviceId,endpoint:serviceEndpoint(initial),externalSession:plan.action==='login'&&plan.args.method==='access-token',generation:(i.matrix.account?.generation||0)+1};i.matrix.view=null;i.matrix.selected=null;i.matrix.messageVerification=null;i.matrix.version=(i.matrix.version||0)+1;});
    result={state:'complete',completed:['account-identity-verified','session-saved'],result:{userId:account.userId}};
   }else if(plan.action==='acknowledge-outcome'){
    await refresh(plan.instanceId);
    await update(plan.instanceId,i=>{const op=i.matrix.operations.find(o=>o.id===plan.args.operationId);check(op,!!op&&['applying','partial','unknown'].includes(op.state),'matrix_no_uncertain_operation');op.state='acknowledged';});
    result={state:'complete',completed:['outcome-acknowledged'],result:{}};
   }else{
    check(initial,initial.matrix?.account?.endpoint===serviceEndpoint(initial),'matrix_sign_in_required',401);
    const who=await client.whoami();check(who,who.userId===initial.matrix.account.userId,'matrix_account_changed');
    if(plan.action==='logout'){
     check(initial,!initial.matrix.account.externalSession||plan.args.revokeExternal===true,'matrix_external_session_revocation_requires_acknowledgement');
     await client.logout();
     await update(plan.instanceId,i=>{i.matrix.account=null;i.matrix.view=null;i.matrix.selected=null;i.matrix.messageVerification=null;i.matrix.version=(i.matrix.version||0)+1;});
     result={state:'complete',completed:['session-revoked'],result:{}};
    }else if(plan.action==='select-space'){
     const space=await client.room(plan.args.spaceId,who.userId);check(space,space.kind==='space'&&space.membership==='join','matrix_membership_not_verified');
     await update(plan.instanceId,i=>{i.matrix.selected={spaceId:space.roomId,endpoint:serviceEndpoint(initial),userId:who.userId,credentialRef:initial.matrix.account.credentialRef,observedAt:at};});
     result={state:'complete',completed:['space-membership-verified','selection-saved'],result:{}};
    }else if(plan.action==='select-room'){
     const room=await client.room(plan.args.roomId,who.userId);check(room,room.membership==='join','matrix_membership_not_verified');
     if(plan.args.spaceId){const space=await client.room(plan.args.spaceId,who.userId);check(space,space.kind==='space'&&space.children.includes(room.roomId),'matrix_space_relationship_unverified');}
     await update(plan.instanceId,i=>{i.matrix.selected={...i.matrix.selected,...plan.args,relationshipVerified:!!plan.args.spaceId,endpoint:serviceEndpoint(initial),userId:who.userId,credentialRef:initial.matrix.account.credentialRef,observedAt:at};});
     result={state:'complete',completed:['membership-verified','selection-saved'],result:{}};
    }else{
     if(plan.action==='message-test')check(initial,initial.matrix.selected?.roomId===plan.args.roomId&&initial.matrix.selected?.credentialRef===initial.matrix.account.credentialRef,'matrix_select_test_room_first');
     result=await client.execute(plan.action,plan.args,{userId:who.userId,operationId:plan.id,recoveryRoomId:plan.dmRecoveryRoomId,checkpoint});
     if(plan.action==='message-test')await update(plan.instanceId,i=>{i.matrix.messageVerification={...result.result,endpoint:serviceEndpoint(initial),userId:who.userId,credentialRef:initial.matrix.account.credentialRef,observedAt:at};});
    }
   }
  }catch(e){result={state:e.partial?'partial':e.code?.startsWith('matrix_')&&e.code!=='matrix_outcome_unknown'?'failed':'unknown',error:e.code?.startsWith('matrix_')?e.code:'matrix_outcome_unknown',completed:e.partial?['account-created']:[],result:{}};}
  await checkpoint({...result,observedAt:new Date(clock()).toISOString()});
  if(result.state==='complete'&&!['logout','acknowledge-outcome'].includes(plan.action))await refresh(plan.instanceId).catch(()=>{});
  await store.retireReview(plan.id);return result;
 }
 return {admit,
  async get(r){admit(r);return snapshot();},
  async post(r,body){
   admit(r,true);check(body,body?.schema==='zenith.hub-matrix-action.v1','matrix_invalid_action',400);
   check(null,!busy,'matrix_busy');busy=true;
   try{
    if(body.operation==='refresh'){closed(body,['schema','operation','instanceId']);await refresh(body.instanceId);return snapshot();}
    if(body.operation==='review'){
     closed(body,['schema','operation','instanceId','action','args']);validateMatrixAction(body.action,body.args);
     const i=instance(await store.read(),body.instanceId);check(i,i.enabled!==false,'matrix_connection_disabled');
     if(body.action==='bootstrap')check(i,i.mode==='install'&&i.configured===true,'matrix_local_management_required',403);
     const plan={id:'matrix-'+randomBytes(18).toString('hex'),action:body.action,args:body.args,instanceId:i.instanceId,binding:bound(i),endpoint:serviceEndpoint(i),account:i.matrix?.account?.userId||null,driverDigest:await driverDigest(),expiresAt:clock()+120000,effects:[matrixActionEffects[body.action]]};
     if(body.action==='start-dm'){
      const prior=i.matrix?.operations?.find(o=>o.action==='start-dm'&&o.args.userId===body.args.userId&&o.binding===bound(i)&&['partial','acknowledged'].includes(o.state)&&typeof o.result?.roomId==='string');
      if(prior){plan.dmRecoveryRoomId=prior.result.roomId;plan.effects=['Finish the direct-message mapping for retained room '+prior.result.roomId+'. No new room or invitation will be created.'];}
     }
     await store.saveReview(plan);await update(i.instanceId,current=>{current.matrix={...current.matrix,reviewId:plan.id};});return {schema:'zenith.hub-matrix-review.v1',plan};
    }
    if(body.operation==='read-review'){closed(body,['schema','operation','planId']);const plan=await store.getReview(body.planId);check(plan,plan?.id?.startsWith('matrix-'),'matrix_review_missing');return {schema:'zenith.hub-matrix-review.v1',plan};}
    if(body.operation==='apply'){
     closed(body,['schema','operation','planId'],['secret']);const plan=await store.getReview(body.planId);
     check(plan,plan?.id?.startsWith('matrix-'),'matrix_review_missing');check(plan,clock()<plan.expiresAt,'matrix_review_expired');validateMatrixAction(plan.action,plan.args);check(plan,plan.driverDigest===await driverDigest(),'matrix_review_implementation_changed');
     const result=await perform(plan,body.secret);return {...await snapshot(),result};
    }
    if(body.operation==='cancel'){closed(body,['schema','operation','planId']);const plan=await store.getReview(body.planId);check(plan,plan?.id?.startsWith('matrix-'),'matrix_review_missing');await store.retireReview(plan.id);await update(plan.instanceId,i=>{if(i.matrix?.reviewId===plan.id)i.matrix.reviewId=null;});return snapshot();}
    check(body,false,'matrix_action_unsupported',400);
   }finally{busy=false;}
  }
 };
}
