import {serviceMonitor} from './hub/monitoring.mjs';
import {operatorCsrf} from './operator-session.mjs';
import {OperatorError} from "./pilot-controller.mjs";
import {readAction} from "./operator-http.mjs";
import {readRegistry,privateBytes,publicResource,changeRegistry} from "./resource-registry.mjs";
const empty=r=>({...publicResource(r),ready:false,connected:false,
  state:r.enabled?"checking":"disconnected",observedAt:null});
export function createResourceController({env=process.env,fetcher=fetch,now=Date.now}={}) {
  const file=env.ZENITH_HUB_RESOURCES_FILE;
  const database=async()=>{const owner=await import('./application/owner.mjs');return env.ZENITH_HUB_APPLICATION_DB==='1'||await owner.activation(owner.setupRoot(env))?owner.applicationForEnv(env):null;};
  const applicationStore={async read(){const app=await database();return app?app.readResources():readRegistry(file);},async change(action){const app=await database();return app?app.changeResources(action):changeRegistry(file,action);}};
  const enabled=!!file && (env.ZENITH_NATIVE_DEMO==="1" || env.ZENITH_LOCAL_OPERATOR==="1");
  const origin=env.ZENITH_OPERATOR_ORIGIN || "http://127.0.0.1:4218";
  const expected=new URL(origin),csrf=operatorCsrf('connections',env);
  if(expected.origin!==origin || expected.protocol!=="http:" || expected.hostname!=="127.0.0.1" || !expected.port)
    throw new OperatorError("invalid_resource_operator_origin");
  const cache=new Map();let refreshing=null,lastRefresh=0;
  function admit(request,mutation=false) {
    if(!enabled)throw new OperatorError("resources_disabled",403);
    const site=request.headers.get("sec-fetch-site"),supplied=request.headers.get("origin");
    if(new URL(request.url).origin!==origin || request.headers.get("host")!==expected.host ||
       (supplied && supplied!==origin) || (site && !["same-origin","none"].includes(site)))
      throw new OperatorError("wrong_origin",403);
    if(mutation && (supplied!==origin || request.headers.get("x-zenith-csrf")!==csrf ||
       request.headers.get("content-type")!=="application/json"))
      throw new OperatorError("resource_action_forbidden",403);
  }
  async function read(url,headers={}) {
    const response=await fetcher(url,{headers,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!response.ok) {
      await response.body?.cancel();
      const state={401:"authentication_failed",403:"access_denied",503:"not_ready"}[response.status] || "api_rejected";
      throw Object.assign(new Error(state),{resourceState:state});
    }
    return await readAction({headers:response.headers,body:response.body},{limit:1048576,deadline:15000});
  }
  async function inspect(r) {
    let result=empty(r);
    if(!r.enabled)return result;
    const monitor=serviceMonitor(env, 'connections:'+r.id);
    try {
      const health=await monitor('Readiness',()=>read(r.endpoint+"/ready"),r=>r.ready===true?null:'Service not ready');
      if(health.ready!==true)return {...result,state:"not_ready",observedAt:new Date(now()).toISOString()};
      const token=await monitor('Credential',async()=>{
        const value=(await privateBytes(r.credentialFile,128)).toString("utf8").trim();
        if(!/^dgread1_[A-Za-z0-9_-]{43}$/.test(value))throw new OperatorError("unsafe_resource_credential");
        return value;
      });
      await monitor("Read work",async()=>{
      const page=await read(r.endpoint+"/work/Task?limit=1",{Accept:"application/json",Authorization:"Bearer "+token});
      if(!page || !Array.isArray(page.items) || page.items.length>1 ||
         page.items.some(v=>!v || typeof v!=="object" || Array.isArray(v)))
        throw Object.assign(new Error(),{resourceState:"incompatible_contract"});
      });
      result={...result,ready:true,connected:true,state:"connected"};
    } catch(e) {
      const unsafe=e instanceof OperatorError && ["unsafe_resource_file","unsafe_resource_credential"].includes(e.code);
      result={...result,state:e.resourceState || (unsafe || ["ENOENT","ELOOP","EACCES","ENOTDIR"].includes(e.code)
        ? "credential_unavailable" : e instanceof SyntaxError ||
          ["invalid_request","request_too_large"].includes(e.code) ? "incompatible_contract":"unavailable")};
    }
    return {...result,observedAt:new Date(now()).toISOString()};
  }
  async function snapshot(force=false) {
    if(!enabled)return {schema:"zenith.hub-resource-snapshot.v1",mode:"disabled",revision:null,resources:[]};
    let registry;
    try {registry=applicationStore?await applicationStore.read():await readRegistry(file);}
    catch {return {schema:"zenith.hub-resource-snapshot.v1",mode:"local",registryState:"configuration_unavailable",revision:null,resources:[]};}
    const missing=registry.resources.some(r=>r.enabled && cache.get(r.id)?.revision!==registry.revision);
    if(!refreshing && (force || missing || !lastRefresh || now()-lastRefresh>=10000)) {
      const revision=registry.revision;
      refreshing=(async()=>{
        const observed=await Promise.all(registry.resources.map(inspect));
        for(const r of observed)cache.set(r.id,{revision,value:r});
        lastRefresh=now();
      })().finally(()=>{refreshing=null;});
    }
    if(force && refreshing)await refreshing;
    const resources=registry.resources.map(r=>{
      const entry=cache.get(r.id);
      return !r.enabled ? empty(r) : entry?.revision===registry.revision ? entry.value : empty(r);
    });
    return {schema:"zenith.hub-resource-snapshot.v1",mode:"local",registryState:"configured",
            revision:registry.revision,resources};
  }
  return {enabled,snapshot,
    async get(request) {admit(request);return {...await snapshot(),csrf};},
    async post(request,body) {
      admit(request,true);
      if(!body || body.schema!=="zenith.hub-resource-action.v1")throw new OperatorError("invalid_resource_action");
      if(body.operation==="refresh" && Object.keys(body).sort().join(",")==="operation,schema")
        return {...await snapshot(true),applied:true};
      if(body.operation!=="set-enabled" || !["enabled,expectedRevision,operation,resourceId,schema","enabled,expectedGeneration,expectedRevision,operation,resourceId,schema"].includes(Object.keys(body).sort().join(",")) ||
         typeof body.enabled!=="boolean" || !Number.isSafeInteger(body.expectedRevision) || typeof body.resourceId!=="string")
        throw new OperatorError("invalid_resource_action");
      await (applicationStore?applicationStore.change(body):changeRegistry(file,body));
      cache.clear();lastRefresh=0;
      return {...await snapshot(),applied:true};
    }
  };
}
export const resourceController=createResourceController();
