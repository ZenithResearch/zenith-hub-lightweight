import { createWorkspaceController } from "@/lib/workspace-controller.mjs";
import { OperatorError } from "@/lib/pilot-controller.mjs";
import { readAction, normalizeNextRequest } from "@/lib/operator-http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const controller = createWorkspaceController();
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function rejected(error: unknown) { return Response.json({ error: error instanceof OperatorError ? error.code : "workspace_unavailable" }, { status: error instanceof OperatorError ? error.status : 503, headers }); }
export async function GET(request: Request) { try {
    return Response.json(await controller.get(controller.enabled ? normalizeNextRequest(request) : request), { headers });
}
catch (e) {
    return rejected(e);
} }
export async function POST(request: Request) { try {
    const effective = normalizeNextRequest(request);
    controller.admitMutation(effective);
    const body = await readAction(request, { limit: 65536 });
    return Response.json(await controller.post(effective, body), { headers });
}
catch (e) {
    return rejected(e);
} }
