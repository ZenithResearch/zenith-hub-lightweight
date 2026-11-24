export type HubApplicationOwner={
 repository:{definitions:{ajv:{getSchema(id:string):((value:unknown)=>boolean)|undefined};assets:Map<string,Buffer>}};
 status():Promise<Record<string,unknown>>;
 inventory:{read():Promise<Record<string,unknown>>;inspect(input:Record<string,unknown>):Promise<Record<string,unknown>>;register(handle:string):Promise<Record<string,unknown>>};
};
export function applicationForEnv(env?:NodeJS.ProcessEnv):Promise<HubApplicationOwner>;
export function applicationForRoot(root:string,options?:Record<string,unknown>):Promise<HubApplicationOwner>;
export function activation(root:string):Promise<Record<string,unknown>|null>;
export function setupRoot(env:NodeJS.ProcessEnv):string;
