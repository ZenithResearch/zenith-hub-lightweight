import {createObjectController} from '@/lib/objects/controller.mjs';
import {normalizeNextRequest, readAction} from '@/lib/operator-http.mjs';
import {OperatorError} from '@/lib/pilot-controller.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const controller = createObjectController();
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
function rejected(error: unknown, mutation = false) {
  const value = error as OperatorError & {details?: unknown};
  return Response.json({error: error instanceof OperatorError ? value.code : 'object_store_unavailable',
    ...(value.details ? {details: value.details} : {}),
    ...(mutation ? {created: [], updated: [], alreadyPresent: [], rejected: 'entire_batch', committed: false} : {})},
    {status: error instanceof OperatorError ? value.status : 503, headers});
}
export async function GET(request: Request) {
  try {
    const value = await controller.get(normalizeNextRequest(request));
    return value.jsonld || value.bundle ? new Response(JSON.stringify(value.document), {headers: {...headers, 'Content-Type': value.bundle ? 'application/vnd.zenith.hub-object-bundle+json' : 'application/ld+json'}})
      : Response.json(value, {headers});
  } catch (error) {return rejected(error);}
}
export async function POST(request: Request) {
  try {
    const effective = normalizeNextRequest(request);
    controller.admitMutation(effective);
    return Response.json(await controller.post(effective,
      await readAction(request, {limit: 5*1024**2, deadline: 5000})), {headers});
  }
  catch (error) {return rejected(error, true);}
}
