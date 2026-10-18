export function canonical(value: unknown): string;
export function createWorkspaceController(options?: Record<string, unknown>): {
    enabled: boolean;
    admitMutation(request: {
        url: string;
        headers: Headers;
    }): void;
    get(request: {
        url: string;
        headers: Headers;
    }): Promise<unknown>;
    post(request: {
        url: string;
        headers: Headers;
    }, body: unknown): Promise<unknown>;
};
