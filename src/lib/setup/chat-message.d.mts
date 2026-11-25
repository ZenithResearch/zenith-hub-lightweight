export const CHAT_MESSAGE_LIMIT: number;
export const PAGE_CONTENT_LIMIT: number;
export type PageContext = { title: string; path: string; text: string };
export function appendPageContext(message: string, context: PageContext | null): string;

export const CHAT_HISTORY_LIMIT:number;
export const CHAT_HISTORY_MESSAGES:number;
export type ChatHistoryMessage={role:"user"|"assistant";content:string};
export function validateChatHistory(value:unknown):ChatHistoryMessage[];

export function buildChatAction(instanceId:string|undefined,message:string,history?:readonly ChatHistoryMessage[]):{schema:string;operation:string;instanceId:string|undefined;message:string;history?:ChatHistoryMessage[]};
