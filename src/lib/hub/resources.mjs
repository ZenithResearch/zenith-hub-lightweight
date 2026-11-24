/** Read-only gallery rows derived from the owning setup/connection records. No graph writes. */
import path from 'node:path';
import {serviceEndpoint} from '../setup/connections.mjs';
export function resourceStatus(item,now=Date.now()) {
  if(item.enabled===false)return 'Disconnected';
  if(item.partial || item.mode==='install' && item.installed===false)return 'Setup incomplete';
  if(item.componentId==='frank')return item.installed===true?'Installed':'Installation not verified';
  if(item.mode==='install' && item.running===false)return 'Stopped';
  const o=item.observation,age=now-Date.parse(o?.observedAt);
  if(!o || !Number.isFinite(age) || age>30000 || age< -5000)return 'Status needs refresh';
  if(['credential-required','authentication_failed','access_denied'].includes(o.permission))return 'Credentials required';
  if(!o.reachable)return 'Connection saved · unavailable';
  if(item.componentId==='hermes')return o.chatAvailable===true?'Ready':'Needs configuration';
  if(o.applicationReady===true)return 'Ready';
  return 'API reachable';
}
// A display alias for the former default only; persisted objects and custom names retain their identity.
export function instanceLabel(item,descriptor) {
  const label=item.config?.label || descriptor?.label || item.componentId || item.instanceId;
  return item.componentId==='hermes' && label==='Hermes guide'?'Hermes':label;
}
function configView(config={}) {
  return Object.fromEntries(['endpoint','port','label','serverName','providerId','modelName','modelEndpoint','contextLength'].filter(k=>['string','number'].includes(typeof config[k])).map(k=>[k,config[k]]));
}
export function setupResources(snapshot,now=Date.now()) {
  return (snapshot.instances||[]).map(item=>{
    const descriptor=snapshot.catalog?.components.find(c=>c.id===item.componentId);
    const managed=['install','vps'].includes(item.mode),local=item.mode==='install',daemon=descriptor?.health!=='none' && item.componentId!=='frank';
    const actions=[];
    if(local && !item.partial && daemon && item.running===false && item.configured===true)actions.push('start');
    if(local && !item.partial && daemon && item.running===true)actions.push('stop');
    if(local && !item.partial && item.componentId!=='hermes' && item.running===false)actions.push('configure');
    if(local && item.partial)actions.push('resume-install');
    const label=instanceLabel(item,descriptor);
    return {key:'setup:'+item.instanceId,source:'setup',instanceId:item.instanceId,componentId:item.componentId,
      label,purpose:descriptor?.description || 'Configured app or service instance',
      mode:item.mode,managed,local,daemon,enabled:item.enabled!==false,partial:item.partial===true,
      installed:item.installed??null,configured:item.configured??null,running:item.running??null,
      endpoint:serviceEndpoint(item),config:configView({...item.config,...(item.config?.label?{label}:{})}),targetId:item.targetId || null,
      dataPath:local && item.root ? path.join(item.root,'data'):null,
      status:resourceStatus(item,now),observedAt:item.observation?.observedAt || null,
      observation:item.observation ? Object.fromEntries(['observedAt','reachable','applicationReady','permission','contract','chatAvailable'].filter(k=>['string','boolean'].includes(typeof item.observation[k])).map(k=>[k,item.observation[k]])):null,
      actions,sourceRevision:snapshot.revision};
  });
}
export function connectionResources(snapshot) {
  return (snapshot.resources||[]).map(r=>({key:'connections:'+r.id,source:'connections',instanceId:r.id,componentId:r.kind,
    label:r.label,purpose:'Independently managed work graph',mode:'connect',managed:false,local:false,daemon:true,
    enabled:r.enabled,endpoint:r.endpoint,config:{endpoint:r.endpoint},status:r.connected?'Ready to read':r.enabled?'Connection saved · '+r.state.replaceAll('_',' '):'Disconnected',
    observedAt:r.observedAt,observation:{observedAt:r.observedAt,reachable:r.ready===true,applicationReady:r.connected===true},
    actions:[],sourceRevision:snapshot.revision}));
}
