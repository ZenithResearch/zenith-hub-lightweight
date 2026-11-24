import {applicationForEnv} from '@/lib/application/owner.mjs';
import {setupController} from '@/lib/setup/runtime';
import {normalizeNextRequest,readAction} from '@/lib/operator-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function failure(error:unknown){const e=error as {code?:string;status?:number};return Response.json({error:e.code||'inventory_unavailable'},{status:e.status||503,headers});}
export async function GET(request:Request){try{const session=setupController.session(normalizeNextRequest(request));return Response.json({...await (await applicationForEnv()).inventory.read(),csrf:session.csrf},{headers});}catch(e){return failure(e);}}
export async function POST(request:Request) {
 try {
  setupController.admitMutation(normalizeNextRequest(request));
  const value=await readAction(request,{limit:16384,deadline:5000});
  const body=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
  if(!body||body.schema!=='zenith.hub-inventory-action.v1'||body.operation!=='register-existing'||typeof body.inspectionHandle!=='string'||Object.keys(body).sort().join(',')!=='inspectionHandle,operation,schema')return Response.json({error:'invalid_inventory_action'},{status:400,headers});
  return Response.json(await (await applicationForEnv()).inventory.register(body.inspectionHandle),{headers});
 }catch(e){return failure(e);}
}
