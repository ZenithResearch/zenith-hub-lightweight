import { setupController as controller } from "@/lib/setup/runtime";
import { normalizeNextRequest, readAction } from "@/lib/operator-http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function failure(error: unknown) {
  const e = error as { code?: string; status?: number; publicMessage?: string };
  return Response.json(
    {
      error: e.code || "setup_action_incomplete",
      message: e.publicMessage?.slice(0, 500) ||
        "Refresh the setup state and reconcile the retained operation before retrying.",
    },
    { status: e.status || 409, headers },
  );
}
export async function GET(request: Request) {
  try {
    return Response.json(await controller.get(normalizeNextRequest(request)), {
      headers,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const r = normalizeNextRequest(request);
    controller.admitMutation(r);
    return Response.json(
      await controller.post(
        r,
        await readAction(request, { limit: 65536, deadline: 5000 }),
      ),
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}
