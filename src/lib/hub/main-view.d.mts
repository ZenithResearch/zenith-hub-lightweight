import type {MainHubModel} from "../../vendor/zenith-ui/MainHub/MainHub";
export function settingsHref(componentId:string,resourceKey?:string):string;
export function settingsIntent(search:string,snapshot:unknown):{kind:"select";resourceKey:string}|{kind:"multiple";label:string;count:number}|{kind:"add";componentId:string}|null;
export function projectMainHub(input?:{hub?:unknown;matrix?:unknown;loading?:boolean;errors?:{hub?:string;matrix?:string};now?:number;includeConversations?:boolean}):MainHubModel;
