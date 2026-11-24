import {applicationForEnv} from '@/lib/application/owner.mjs';
import {setupController} from '@/lib/setup/runtime';
import {normalizeNextRequest,readAction} from '@/lib/operator-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
 try {
  setupController.admitMutation(normalizeNextRequest(request));
  const value=await readAction(request,{limit:16384,deadline:5000});
  const app=await applicationForEnv(),definitions=app.repository.definitions;
  const document=definitions.assets.get('api.schema.json');
  if(!document)throw Error('inspection_schema_missing');
  const validate=definitions.ajv.getSchema(JSON.parse(document.toString()).$id+'#/$defs/InspectionRequest');
  if(!validate||!validate(value)||!value||typeof value!=='object'||Array.isArray(value))return Response.json({error:'invalid_inspection_request'},{status:400});
  const {schema:ignored,...input}=value as Record<string,unknown>;
  return Response.json(await app.inventory.inspect(input),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const e=error as {code?:string;status?:number};return Response.json({error:e.code||'inspection_unavailable'},{status:e.status||503,headers:{'Cache-Control':'no-store'}});}
}
