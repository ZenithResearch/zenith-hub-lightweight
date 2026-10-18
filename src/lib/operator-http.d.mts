export function readAction(request: Request, options?: {limit?: number; deadline?: number}): Promise<unknown>;
export function normalizeNextRequest(
  request: Request,
  origin?: string,
): { url: string; headers: Headers };
