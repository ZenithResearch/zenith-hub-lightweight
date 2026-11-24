import {operatorCsrf} from '../operator-session.mjs';
import {randomBytes} from 'node:crypto';
import {check,digest} from '../setup/catalog.mjs';
import {resourceController} from '../resource-controller.mjs';
import {setupResources,connectionResources,instanceLabel} from './resources.mjs';
const fields=(body,required,optional=[])=>check(body,body&&typeof body==='object'&&!Array.isArray(body)&&required.every(k=>Object.hasOwn(body,k))&&Object.keys(body).every(k=>[...required,...optional].includes(k)),'invalid_hub_action',400);
export function createHubController({env=process.env,setup,connections=resourceController,clock=Date.now}={}) {
  const origin=env.ZENITH_OPERATOR_ORIGIN || 'http://127.0.0.1:4208';
  const url=new URL(origin),csrf=operatorCsrf('gallery',env),plans=new Map();
  check(origin,url.origin===origin&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port,'invalid_operator_origin');
  let refreshing,cached,cachedAt=0;
  const database=async()=>{const owner=await import('../application/owner.mjs');return env.ZENITH_HUB_APPLICATION_DB==='1'||await owner.activation(owner.setupRoot(env))?owner.applicationForEnv(env):null;};
  const savePlan=async(id,value)=>{const app=await database();if(app)value.applicationGeneration=await app.saveHubReview(id,value);plans.set(id,value);};
  const getPlan=async id=>(await (await database())?.getHubReview(id))||plans.get(id);
  const retirePlan=async id=>{plans.delete(id);await (await database())?.retireHubReview(id);};
  const known={setup:[],connections:[],setupSnapshot:null};
  function admit(request,mutation=false) {
    check(env,env.ZENITH_LOCAL_OPERATOR==='1'&&env.ZENITH_GUIDED_SETUP==='1','hub_disabled',403);
    const headers=request.headers,supplied=headers.get('origin'),site=headers.get('sec-fetch-site');
    check(request,new URL(request.url).origin===origin&&headers.get('host')===url.host&&(!supplied||supplied===origin)&&(!site||['same-origin','none'].includes(site)),'wrong_origin',403);
    if(mutation)check(request,supplied===origin&&headers.get('content-type')==='application/json'&&headers.get('x-zenith-csrf')===csrf,'cross_site_action',403);
  }
  function ownerRequest(request,token){const headers=new Headers(request.headers);headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-zenith-csrf',token);return {url:request.url,headers};}
  async function setupPost(request,body,snapshot) {
    const current=snapshot||await setup.get(request);
    return setup.post(ownerRequest(request,current.csrf),{schema:'zenith.hub-setup-action.v1',...body});
  }
  async function refresh(request) {
    const warnings=[];
    let setupSnapshot=null,connectionSnapshot=null;
    const stale=rows=>rows.map(r=>({...r,status:'Status unverified',stale:true,actions:[]}));
    let setupRows=known.setup,connectionRows=known.connections;
    try {
      setupSnapshot=await setup.get(request);
      check(setupSnapshot,setupSnapshot.mode==='local','setup_unavailable');
      if(setupSnapshot.catalogStatus?.state==='last-good')warnings.push({source:'catalog',message:'Using catalog '+setupSnapshot.catalogPackage.version+'; update rejected ('+setupSnapshot.catalogStatus.error+').'});
      setupRows=setupResources(setupSnapshot,clock());
      known.setup=setupRows;known.setupSnapshot=setupSnapshot;
    } catch {
      setupSnapshot=null;setupRows=stale(known.setup);
      warnings.push({source:'setup',message:known.setup.length?'Setup is unavailable. Previously loaded resources are shown unverified.':'Saved setup resources could not be loaded.'});
    }
    try {
      connectionSnapshot=await connections.snapshot();
      if(connectionSnapshot.mode==='local'&&connectionSnapshot.registryState==='configured') {
        connectionRows=connectionResources(connectionSnapshot);known.connections=connectionRows;
      } else if(known.connections.length) {
        connectionRows=stale(known.connections);
        warnings.push({source:'connections',message:'The external connection registry is unavailable. Previously loaded connections are shown unverified.'});
      } else connectionRows=[];
    } catch {
      connectionRows=stale(known.connections);
      warnings.push({source:'connections',message:'External connections could not be refreshed.'});
    }
    const display=setupSnapshot||known.setupSnapshot;
    const resources=[...setupRows,...connectionRows].sort((a,b)=>a.label.localeCompare(b.label));
    const value={schema:'zenith.hub-overview.v1',mode:'local',csrf,
      revision:digest([setupSnapshot?.revision??null,connectionSnapshot?.revision??null]),setupRevision:setupSnapshot?.revision??null,
      observedAt:new Date(clock()).toISOString(),resources,warnings,busy:setupSnapshot?.busy===true,
      operations:(display?.operations||[]).map(o=>({id:o.id,action:o.action,state:o.state,phase:o.phase,outcomeUnknown:o.outcomeUnknown,instanceIds:o.instanceIds,error:o.error,progress:o.progress})),
      catalog:(display?.catalog?.components||[]).map(c=>({id:c.id,label:c.label,description:c.description,modes:c.modes.filter(m=>m!=='vps'),defaultPort:c.defaultPort,serviceRequirements:c.serviceRequirements,source:c.source}))};
    cached=value;cachedAt=clock();return value;
  }
  async function snapshot(request,force=false) {
    if(!force&&cached&&clock()-cachedAt<5000)return cached;
    if(!refreshing)refreshing=refresh(request).finally(()=>{refreshing=null;});
    return refreshing;
  }
  function publicPlan(plan) {
    return {id:plan.id,action:plan.action,expiresAt:plan.expiresAt,...(plan.catalogPackage?{catalogPackage:plan.catalogPackage}:{}),items:plan.items.map(i=>({instanceId:i.instanceId,componentId:i.componentId,label:instanceLabel(i,i.descriptor),
      mode:i.mode,...(i.recipeRef?{recipeRef:i.recipeRef}:{}),source:i.descriptor?.source,endpoint:i.config?.endpoint||null,destination:i.mode==='connect'?null:i.destination,dataPath:i.dataPath,
      prerequisites:i.prerequisites||[],effects:i.effects||[],downloadBytes:(i.artifacts||[]).reduce((sum,a)=>sum+(a.bytes||0),0),
      serviceRequirements:i.serviceRequirements||[],startBehavior:i.startBehavior,preparationRequired:i.preparation?.ready===false,requiredMiB:i.preparation?.requiredMiB||null}))};
  }
  return {
    async get(request){admit(request);return snapshot(request);},
    async post(request,body) {
      admit(request,true);check(body,body?.schema==='zenith.hub-action.v1','invalid_hub_action',400);
      if(body.operation==='refresh'){fields(body,['schema','operation']);return snapshot(request,true);}
      if(body.operation==='discover'){fields(body,['schema','operation']);return setupPost(request,{operation:'discover'});}
      if(body.operation==='reconcile-setup'){fields(body,['schema','operation']);await setupPost(request,{operation:'reconcile'});return snapshot(request,true);}
      if(body.operation==='cancel'){fields(body,['schema','operation','planId']);const p=await getPlan(body.planId);if(p?.kind==='setup')await setupPost(request,{operation:'cancel',planId:body.planId});await retirePlan(body.planId);return {cancelled:true};}
      if(['plan-add','plan-control'].includes(body.operation)){for(const [id,p] of plans)if(clock()>=p.expiresAt)plans.delete(id);check(plans,plans.size<16,'too_many_pending_reviews',409);}
      if(body.operation==='plan-add') {
        fields(body,['schema','operation','componentId','instanceId','mode','config','expectedRevision'],['prepareArtifacts','recipeId']);
        check(body,body.prepareArtifacts===undefined||body.prepareArtifacts===true&&body.componentId==='matrix'&&body.mode==='install','invalid_preparation_action',400);
        check(body,['install','connect'].includes(body.mode),'unsupported_component_mode',400);
        const current=await setup.get(request);check(current,current.revision===body.expectedRevision,'setup_revision_changed');
        const overview=await snapshot(request,true);
        check(body,!overview.resources.some(r=>r.instanceId===body.instanceId&&r.source==='setup'),'resource_already_registered');
        const candidate=body.config?.endpoint;
        check(body,!candidate||!overview.resources.some(r=>r.componentId===body.componentId&&r.endpoint===candidate),'connection_already_registered');
        const out=await setupPost(request,{operation:'plan',action:body.prepareArtifacts?'prepare-artifacts':body.mode==='connect'?'connect':'install',expectedRevision:current.revision,
          selection:[{instanceId:body.instanceId,componentId:body.componentId,mode:body.mode,config:body.config,...(body.recipeId?{recipeId:body.recipeId}:{})}]},current);
        await savePlan(out.plan.id,{kind:'setup',expiresAt:out.plan.expiresAt});return {schema:'zenith.hub-plan.v1',plan:publicPlan(out.plan)};
      }
      if(body.operation==='plan-control') {
        fields(body,['schema','operation','resourceKey','action']);
        const overview=await snapshot(request,true),resource=overview.resources.find(r=>r.key===body.resourceKey);
        check(resource,resource&&!resource.stale,'resource_unavailable');
        if(['disconnect','reconnect'].includes(body.action)) {
          check(resource,resource.mode==='connect','external_connection_required');
          const id=randomBytes(18).toString('hex'),plan={id,action:body.action,expiresAt:clock()+120000,items:[{instanceId:resource.instanceId,label:resource.label,mode:'connect',endpoint:resource.endpoint,prerequisites:[],effects:[body.action==='disconnect'?'Disable only this Hub connection. The external service and its data remain unchanged.':'Enable this saved Hub connection. No service is installed or started.']}]};
          await savePlan(id,{kind:'connection',expiresAt:plan.expiresAt,resource,enabled:body.action==='reconnect'});return {schema:'zenith.hub-plan.v1',plan};
        }
        check(resource,resource.source==='setup'&&resource.actions.includes(body.action),'unsupported_resource_action');
        const current=await setup.get(request),out=await setupPost(request,{operation:'plan',action:body.action,instanceId:resource.instanceId,expectedRevision:current.revision},current);
        await savePlan(out.plan.id,{kind:'setup',expiresAt:out.plan.expiresAt});return {schema:'zenith.hub-plan.v1',plan:publicPlan(out.plan)};
      }
      if(body.operation==='apply') {
        fields(body,['schema','operation','planId']);const plan=await getPlan(body.planId);
        check(plan,plan&&clock()<plan.expiresAt,'hub_plan_expired');
        if(plan.kind==='setup') {
          const out=await setupPost(request,{operation:'apply',planId:body.planId,background:true});
          await retirePlan(body.planId);const overview=await snapshot(request,true);return {...overview,accepted:out.accepted===true,operationId:out.operationId};
        }
        const app=await database();if(app)check(plan,(await app.status()).generation===plan.applicationGeneration,'hub_plan_changed');
        const r=plan.resource;
        if(r.source==='setup') {
          const current=await setup.get(request);check(current,current.revision===r.sourceRevision,'setup_revision_changed');
          await setupPost(request,{operation:'set-connection-enabled',instanceId:r.instanceId,enabled:plan.enabled,expectedRevision:r.sourceRevision,...(plan.applicationGeneration!==undefined?{expectedGeneration:plan.applicationGeneration}:{})},current);
        } else {
          const session=await connections.get(request);
          await connections.post(ownerRequest(request,session.csrf),{schema:'zenith.hub-resource-action.v1',operation:'set-enabled',resourceId:r.instanceId,enabled:plan.enabled,expectedRevision:r.sourceRevision,...(plan.applicationGeneration!==undefined?{expectedGeneration:plan.applicationGeneration}:{})});
        }
        await retirePlan(body.planId);return snapshot(request,true);
      }
      check(body,false,'unknown_hub_operation',400);
    }
  };
}
