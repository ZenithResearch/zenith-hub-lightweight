export function createHubController(options?:Record<string,unknown>): {
 get(request:{url:string;headers:Headers}):Promise<unknown>;
 post(request:{url:string;headers:Headers},body:unknown):Promise<unknown>;
};
