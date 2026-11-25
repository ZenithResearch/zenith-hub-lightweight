import {setupController} from '@/lib/setup/runtime';
import {normalizeNextRequest} from '@/lib/operator-http.mjs';
import {setupRoot} from '@/lib/application/owner.mjs';
import {readHistory} from '@/lib/hub/monitoring.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request) {
  try {
    setupController.session(normalizeNextRequest(request));
    const q=new URL(request.url).searchParams;
    const cursor=q.get('before'), service=q.get('service'), filter=q.get('failures');
    if ((cursor!==null&&(!/^[1-9]\d*$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))) ||
        (service!==null&&service.length>160) || (filter!==null&&filter!=='1')) {
      return Response.json({error:'invalid_history_filter'},{status:400,headers});
    }
    const history=await readHistory(setupRoot(process.env),{before:cursor?Number(cursor):null,service,failures:filter==='1'});
    return Response.json(history,{headers});
  } catch(error) {
    return Response.json({error:'history_unavailable'},{status:(error as {status?:number}).status||503,headers});
  }
}
