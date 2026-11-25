/** Read-only, credential-free presentation over existing Hub and Matrix snapshots. */
const text=(value,fallback='',limit=512)=>typeof value==='string'?value.trim().slice(0,limit)||fallback:fallback;
const rows=value=>Array.isArray(value)?value:[];
const fresh=(at,now)=>{const age=now-Date.parse(at);return Number.isFinite(age)&&age>=-5000&&age<=30000;};
const roomId=value=>typeof value==='string'&&/^![^\s:]+:[^\s]+$/.test(value)&&value.length<=512;
const userId=value=>typeof value==='string'&&/^@[^\s:]+:[^\s]+$/.test(value)&&value.length<=512;
export function settingsHref(componentId,resourceKey){
 return resourceKey?'/settings?resource='+encodeURIComponent(resourceKey):'/settings?component='+encodeURIComponent(componentId);
}
function serviceHref(value){
 try{const u=new URL(value);return ((u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port)||u.protocol==='https:')&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.origin:null;}catch{return null;}
}
export function settingsIntent(search,snapshot){
 const query=new URLSearchParams(search),resources=rows(snapshot?.resources);
 const matrix=query.get('matrix'),resource=query.get('resource'),component=query.get('component');
 if(matrix){const found=resources.find(r=>r.componentId==='matrix'&&r.instanceId===matrix);return found?{kind:'select',resourceKey:found.key}:null;}
 if(resource){const found=resources.find(r=>r.key===resource);return found?{kind:'select',resourceKey:found.key}:null;}
 if(component){
  const found=resources.filter(r=>r.componentId===component);
  if(found.length===1)return {kind:'select',resourceKey:found[0].key};
  const item=rows(snapshot?.catalog).find(c=>c.id===component);
  if(found.length>1)return {kind:'multiple',label:text(item?.label,component),count:found.length};
  if(item)return {kind:'add',componentId:component};
 }
 return null;
}
export function projectMainHub({hub=null,matrix=null,loading=false,errors={},now=Date.now()}={}){
 const hubValid=hub?.schema==='zenith.hub-overview.v1'&&Array.isArray(hub.resources);
 const matrixValid=matrix?.schema==='zenith.hub-matrix.v1'&&Array.isArray(matrix.instances);
 const hubFailed=Boolean(errors.hub)||!hubValid,matrixFailed=Boolean(errors.matrix)||!matrixValid;
 const warnings=[];
 if(!loading&&hubFailed)warnings.push('Work connections could not be verified. Your saved setup is still in Settings.');
 if(!loading&&matrixFailed)warnings.push('Matrix connections could not be verified. Refresh or open Matrix settings.');
 if(hubValid&&rows(hub.warnings).length)warnings.push('Some service connections need a fresh check. Their saved configuration is retained.');
 const conversations=rows(matrix?.instances).filter(i=>typeof i.instanceId==='string').slice(0,100).map(i=>{
  const v=i.view,account=i.account,identity=userId(account?.userId)?account.userId:null;
  const key=i.instanceId;
  let state='unavailable',message='The Matrix account could not be verified. Refresh or check its settings.';
  if(i.enabled===false){state='disabled';message='This Hub connection is disabled. Reconnect it in Settings.';}
  else if(matrixFailed){message='This connection could not be checked. Its saved account is retained.';}
  else if(!account||['sign-in-required','expired','permission-denied'].includes(v?.authentication)){state='sign-in-required';message=v?.authentication==='expired'?'The saved session needs attention. Sign in through Matrix settings.':'Sign in to this Matrix connection to view its conversations.';}
  else if(i.evidence!=='fresh'||!fresh(v?.observedAt,now)){state='stale';message='Saved room information needs a fresh check.';}
  else if(!identity||account.endpoint!==i.endpoint||v?.endpoint!==i.endpoint||v?.authentication!=='authenticated'||v?.account?.userId!==identity||account.deviceId&&account.deviceId!==v.account.deviceId){message='The saved account and latest verification do not match. Refresh before opening conversations.';}
  else{state='verified';message='';}
  const validRoom=r=>roomId(r?.roomId)&&['room','space'].includes(r.kind)&&r.membership==='join'&&typeof r.encrypted==='boolean';
  const canOpen=state==='verified';
  const complete=canOpen&&v.roomsComplete===true&&Array.isArray(v.rooms)&&v.rooms.every(validRoom);
  const rooms=canOpen?rows(v.rooms).filter(r=>validRoom(r)&&r.kind==='room').slice(0,100).map(r=>({key:key+'/'+r.roomId,roomId:r.roomId,name:text(r.name,r.roomId),topic:text(r.topic,'',2000),encrypted:r.encrypted,openHref:'https://matrix.to/#/'+encodeURIComponent(r.roomId)})):[];
  if(canOpen&&!complete){state='partial';message='Only verified conversations are shown. The room list is incomplete.';}
  return {key,label:text(i.label,'Matrix'),userId:identity,state,message,settingsHref:'/settings?matrix='+encodeURIComponent(i.instanceId),rooms,roomsComplete:complete,invitations:canOpen&&v.invitationState==='verified'?rows(v.invitations).length:null};
 });
 if(!loading&&matrixFailed&&!conversations.length)conversations.push({key:'matrix-unverified',label:'Matrix',userId:null,state:'unavailable',message:'Saved Matrix connections could not be read. Refresh or open Settings.',settingsHref:settingsHref('matrix'),rooms:[],roomsComplete:false,invitations:null});
 const descriptors=[{id:'service-management',name:'Service Management',description:'Requests and cases.'},{id:'devgraph',name:'Devgraph',description:'Tasks, issues and projects.'}];
 const work=descriptors.flatMap(d=>{
  const found=rows(hub?.resources).filter(r=>r.componentId===d.id);
  if(!found.length)return [{key:d.id,name:d.name,description:d.description,status:hubFailed?'Not verified':'Not configured',message:hubFailed?'Refresh to check this connection.':'Connect '+d.name+' in Settings to use it for your work.',settingsHref:settingsHref(d.id),openHref:null}];
  return found.map(r=>{
   const ready=!hubFailed&&!r.stale&&r.enabled!==false&&fresh(r.observedAt,now)&&['Ready','Ready to read'].includes(r.status);
   const openHref=ready?serviceHref(r.endpoint):null;
   return {key:text(r.key,d.id),name:text(r.label,d.name),description:d.description,status:hubFailed?'Not verified':text(r.status,'Not verified'),message:openHref?'Open this service to use its work. Work items are not loaded into this Hub yet.':'Check this connection in Settings before using it for work.',settingsHref:settingsHref(d.id,r.key),openHref};
  });
 });
 return {loading,warnings,conversations,work};
}
