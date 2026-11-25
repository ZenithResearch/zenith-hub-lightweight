/** Only m.space.child relationships on verified joined spaces define this filter. */
export function roomsInSpace<T extends {id:string}>(account:{rooms:T[];spaces:{id:string;children:string[]}[]},spaceId:string|null):T[]{
 if(!spaceId)return account.rooms;
 const seen=new Set<string>(),pending=[spaceId],ids=new Set<string>();
 while(pending.length){
  const next=pending.pop()!;if(seen.has(next))continue;seen.add(next);
  const space=account.spaces.find(s=>s.id===next);
  for(const child of space?.children||[]){ids.add(child);if(account.spaces.some(s=>s.id===child))pending.push(child);}
 }
 return account.rooms.filter(room=>ids.has(room.id));
}
