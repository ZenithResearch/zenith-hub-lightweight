// This route performs local operations only when explicitly launched as an operator.
import { createController, OperatorError } from "@/lib/pilot-controller.mjs";
import { readAction, normalizeNextRequest } from "@/lib/operator-http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const controller = process.env.ZENITH_PROCESS_PROFILE === "workspace" ? null : createController();
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(request: Request) {
  try {
    if (!controller) return Response.json({schema:"zenith.deployer.v1",mode:"disabled",profile:"workspace",reason:"Use the workspace page."},{headers});
    return Response.json(
      await controller.get(
        controller.enabled ? normalizeNextRequest(request) : request,
      ),
      { headers },
    );
  } catch (error) {
    return rejected(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!controller) return Response.json({error:"workspace_profile_selected"},{status:403,headers});
    const effective = normalizeNextRequest(request);
    controller.admitMutation(effective);
    const body = await readAction(request);
    return Response.json(await controller.post(effective, body), { headers });
  } catch (error) {
    return rejected(error);
  }
}
function rejected(error: unknown) {
  const known = error instanceof OperatorError;
  return Response.json(
    { error: known ? error.code : "operator_unavailable" },
    { status: known ? error.status : 503, headers },
  );
}
