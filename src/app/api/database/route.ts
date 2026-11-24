import {applicationForEnv} from '@/lib/application/owner.mjs';
import {normalizeNextRequest} from '@/lib/operator-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 const r=normalizeNextRequest(request),expected=process.env.ZENITH_OPERATOR_ORIGIN;
 if(process.env.ZENITH_LOCAL_OPERATOR!=='1'||!expected||new URL(r.url).origin!==expected||r.headers.get('host')!==new URL(expected).host||r.headers.get('origin')&&r.headers.get('origin')!==expected)return Response.json({ready:false,error:'wrong_origin'},{status:403});
 try{return Response.json({...await (await applicationForEnv()).status(),serverInstanceId:process.env.ZENITH_HUB_SERVER_INSTANCE||null},{headers:{'Cache-Control':'no-store'}});}
 catch(error){const e=error as {code?:string};return Response.json({ready:false,error:e.code||'application_database_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
