export type HermesChatMessage={role:"user"|"assistant";content:string};
export type HermesChatTurn={id:number;question:string;reply?:string;failed?:boolean};
export const HERMES_HISTORY_LIMIT=12000;
export const HERMES_HISTORY_MESSAGES=12;
/** Include only whole completed exchanges, newest first within the shared request budget. */
export function hermesChatHistory(turns:readonly HermesChatTurn[]):HermesChatMessage[]{
 const history:HermesChatMessage[]=[];let size=0;
 for(const turn of [...turns].reverse()){
  if(turn.failed||!turn.reply?.trim())continue;
  const length=turn.question.length+turn.reply.length;
  if(size+length>HERMES_HISTORY_LIMIT||history.length+2>HERMES_HISTORY_MESSAGES)break;
  history.unshift({role:"user",content:turn.question},{role:"assistant",content:turn.reply});size+=length;
 }
 return history;
}
/** Bound the browser-only transcript without splitting an exchange. */
export function retainHermesTurns(turns:readonly HermesChatTurn[]):HermesChatTurn[]{
 const kept:HermesChatTurn[]=[];let size=0;
 for(const turn of [...turns].reverse()){
  const length=turn.question.length+(turn.reply?.length||0);
  if(kept.length>=40||size+length>120000)break;
  kept.unshift(turn);size+=length;
 }
 return kept;
}
