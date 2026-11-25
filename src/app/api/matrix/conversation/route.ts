import {createConversationController} from "@/lib/matrix/conversations.mjs";
import {normalizeNextRequest,readAction} from "@/lib/operator-http.mjs";
import {setupRoot} from "@/lib/application/owner.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const key=Symbol.for("zenith.hub.matrix.conversation.controllers.v1");
const globals=globalThis as unknown as Record<symbol,Map<string,ReturnType<typeof createConversationController>>>;
const controllers=globals[key] ||= new Map();
const scope=JSON.stringify([process.env.ZENITH_OPERATOR_ORIGIN,process.env.ZENITH_HUB_SETUP_DIR,process.env.ZENITH_HUB_SERVER_INSTANCE]);
if(!controllers.has(scope))controllers.set(scope,createConversationController({root:setupRoot(process.env)}));
const controller=controllers.get(scope)!;
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){try{const r=normalizeNextRequest(request);controller.admit(r);return Response.json(await controller.post(r,await readAction(request,{limit:32768,deadline:5000})),{headers});}catch(error){const e=error as {code?:string;status?:number};return Response.json({error:e.code?.startsWith("matrix_chat_")?e.code:"matrix_chat_unavailable"},{status:e.status||409,headers});}}
