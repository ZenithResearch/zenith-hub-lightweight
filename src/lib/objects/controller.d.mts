export function createObjectController(options?: Record<string, unknown>): {
  get(request: {url: string; headers: Headers}): Promise<any>;
  post(request: {url: string; headers: Headers}, body: unknown): Promise<any>;
  close(): Promise<void>;
};
