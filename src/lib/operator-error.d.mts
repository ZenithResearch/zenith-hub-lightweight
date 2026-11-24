export function operatorFailure(error: unknown): {
  code: string;
  status: number;
  details?: unknown;
} | null;
