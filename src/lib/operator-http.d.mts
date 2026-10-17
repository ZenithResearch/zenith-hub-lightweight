export function readAction(request: Request): Promise<unknown>;
export function normalizeNextRequest(
  request: Request,
  origin?: string,
): { url: string; headers: Headers };
