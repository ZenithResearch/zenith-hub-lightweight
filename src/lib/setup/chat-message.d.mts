export const CHAT_MESSAGE_LIMIT: number;
export const PAGE_CONTENT_LIMIT: number;
export type PageContext = { title: string; path: string; text: string };
export function appendPageContext(message: string, context: PageContext | null): string;
