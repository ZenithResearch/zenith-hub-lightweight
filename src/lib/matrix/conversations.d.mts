export function createConversationController(options?:Record<string,unknown>):{admit(request:{url:string;headers:Headers}):void;post(request:{url:string;headers:Headers},body:unknown):Promise<unknown>};
export function projectMessages(events:unknown[],userId:string):unknown[];
