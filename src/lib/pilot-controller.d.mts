export class OperatorError extends Error {
  code: string;
  status: number;
}
export function createController(): {
  enabled: boolean;
  admitMutation(request: { url: string; headers: Headers }): void;
  get(request: { url: string; headers: Headers }): Promise<unknown>;
  post(
    request: { url: string; headers: Headers },
    body: unknown,
  ): Promise<unknown>;
};
