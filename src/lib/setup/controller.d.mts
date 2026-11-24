export function createSetupController(options?:Record<string,unknown>):{
 session(request:{url:string;headers:Headers}):{csrf:string;mode:string};
 admitMutation(request:{url:string;headers:Headers}):void;
 get(request:{url:string;headers:Headers}):Promise<unknown>;
 post(request:{url:string;headers:Headers},body:unknown):Promise<unknown>;
};
