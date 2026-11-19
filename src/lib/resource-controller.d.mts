export interface ResourceSummary {
  id:string;kind:"devgraph";label:string;endpoint:string;lifecycle:"external";
  enabled:boolean;readOnly:true;processControl:false;ready:boolean;
  connected:boolean;state:string;observedAt:string|null;
}
export interface ResourceSnapshot {
  schema:"zenith.hub-resource-snapshot.v1";mode:"local"|"disabled";
  revision:number|null;registryState?:string;resources:ResourceSummary[];
}
export function createResourceController(options?:unknown): {
  enabled:boolean;
  snapshot(force?:boolean):Promise<ResourceSnapshot>;
  get(request:{url:string;headers:Headers}):Promise<ResourceSnapshot & {csrf:string}>;
  post(request:{url:string;headers:Headers},body:unknown):Promise<ResourceSnapshot & {applied:true}>;
};
export const resourceController:ReturnType<typeof createResourceController>;
