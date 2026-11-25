import type {MatrixConversationMessage} from "../../vendor/zenith-ui/MatrixChat/MatrixChat";
export type ConversationPayload={schema:string;instanceId:string;roomId:string;binding:string;userId:string;deviceId:string;encrypted:boolean;canSend:boolean;cryptoError:string|null;messages:MatrixConversationMessage[];observedAt:string};
export function conversationSnapshot(value:unknown,target:{instanceId:string;roomId:string;userId:string;deviceId:string}):ConversationPayload;
export function conversationError(code:string):string;
