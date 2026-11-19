export function createObjectController(options?: Record<string, unknown>): {
  admitMutation(request: {url: string; headers: Headers}): void;
  get(request: {url: string; headers: Headers}): Promise<any>;
  post(request: {url: string; headers: Headers}, body: unknown): Promise<any>;
  close(): Promise<void>;
};
