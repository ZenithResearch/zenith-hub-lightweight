import {resourceController} from "@/lib/resource-controller.mjs";
import {normalizeNextRequest,readAction} from "@/lib/operator-http.mjs";
import {OperatorError} from "@/lib/pilot-controller.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function rejected(error:unknown) {
  return Response.json({error:error instanceof OperatorError?error.code:"resource_unavailable"},
    {status:error instanceof OperatorError?error.status:503,headers});
}
export async function GET(request:Request) {
  try {return Response.json(await resourceController.get(normalizeNextRequest(request)),{headers});}
  catch(e) {return rejected(e);}
}
export async function POST(request:Request) {
  try {return Response.json(await resourceController.post(normalizeNextRequest(request),await readAction(request)),{headers});}
  catch(e) {return rejected(e);}
}
