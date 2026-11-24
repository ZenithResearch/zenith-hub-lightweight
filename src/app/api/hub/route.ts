import {createHubController} from "@/lib/hub/controller.mjs";
import {setupController} from "@/lib/setup/runtime";
import {normalizeNextRequest,readAction} from "@/lib/operator-http.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const controller=createHubController({setup:setupController});
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function failure(error:unknown){const e=error as {code?:string;status?:number};return Response.json({error:e.code||"hub_unavailable"},{status:e.status||503,headers});}
export async function GET(request:Request){try{return Response.json(await controller.get(normalizeNextRequest(request)),{headers});}catch(e){return failure(e);}}
export async function POST(request:Request){try{return Response.json(await controller.post(normalizeNextRequest(request),await readAction(request,{limit:65536,deadline:5000})),{headers});}catch(e){return failure(e);}}
