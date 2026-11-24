/** Schema-derived diagram types. No naming convention implies an IRI or foreign key. */
export function schemaDescriber(documents) {
 const warnings=new Set();
 function info(schema,document,trail=new Set(),depth=0) {
  if(depth>80){warnings.add('depth-limit');return {kind:'unknown',label:'unknown_depth',fields:{},required:new Set()};}
  if(schema===true)return {kind:'any',label:'any_JSON',fields:{},required:new Set()};
  if(schema===false)return {kind:'never',label:'never',fields:{},required:new Set()};
  if(!schema||typeof schema!=='object'){warnings.add('missing-schema');return {kind:'unknown',label:'unknown',fields:{},required:new Set()};}
  if(schema.$ref){const [base,fragment='']=schema.$ref.split('#'),doc=base?documents.get(base):document,id=(doc?.$id||base)+'#'+fragment;
   if(trail.has(id)){warnings.add('recursive:'+id);return {kind:'recursive',label:'recursive_reference',fields:{},required:new Set()};}
   if(!doc){warnings.add('unresolved:'+schema.$ref);return {kind:'unknown',label:'unknown_reference',fields:{},required:new Set()};}
   let target=doc;if(fragment){if(!fragment.startsWith('/')){warnings.add('unsupported-anchor:'+id);return {kind:'unknown',label:'unknown_anchor',fields:{},required:new Set()};}for(const p of fragment.slice(1).split('/'))target=target?.[decodeURIComponent(p).replaceAll('~1','/').replaceAll('~0','~')];}
   if(target===undefined){warnings.add('unresolved:'+id);return {kind:'unknown',label:'unknown_reference',fields:{},required:new Set()};}
   const result=info(target,doc,new Set([...trail,id]),depth+1),siblings=Object.fromEntries(Object.entries(schema).filter(([k])=>!['$ref','description','title'].includes(k)));
   return Object.keys(siblings).length?combine([result,info(siblings,document,trail,depth+1)],false):{...result,label:result.kind==='object'&&fragment?fragment.split('/').at(-1):result.label};
  }
  const fields=Object.fromEntries(Object.entries(schema.properties||{}).map(([name,value])=>[name,info(value,document,trail,depth+1)])),required=new Set(schema.required||[]);
  let type=schema.type;if(!type&&schema.const!==undefined)type=schema.const===null?'null':typeof schema.const;if(!type&&schema.enum)type=[...new Set(schema.enum.map(v=>v===null?'null':typeof v))];
  let result;
  if(Array.isArray(type))result=combine(type.map(t=>info({...schema,type:t,oneOf:undefined,anyOf:undefined,allOf:undefined},document,trail,depth+1)),true);
  else if(type==='array'){const item=schema.items?info(schema.items,document,trail,depth+1):{label:'any_JSON',kind:'any',fields:{},required:new Set()};result={kind:'array',label:item.label+'[]',items:item,fields:{},required};}
  else if(type==='object'||Object.keys(fields).length)result={kind:'object',label:'JSON_object',fields,required};
  else {const label=type==='string'&&schema.format==='uri'?(schema.pattern?'IRI':'URI'):type==='string'&&schema.format==='date-time'?'datetime':type||'any_JSON';result={kind:type||'any',label,fields,required};}
  if(schema.allOf)result=combine([result,...schema.allOf.map(s=>info(s,document,trail,depth+1))],false);
  for(const union of [schema.oneOf,schema.anyOf])if(union)result=combine([result,combine(union.map(s=>info(s,document,trail,depth+1)),true)],false);
  return result;
 }
 function combine(values,union) {
  const meaningful=values.filter(v=>v.kind!=='any');if(!meaningful.length)return values[0]||{kind:'any',label:'any_JSON',fields:{},required:new Set()};
  const labels=[...new Set(meaningful.map(v=>v.label))],fields={};
  for(const key of new Set(meaningful.flatMap(v=>Object.keys(v.fields)))){const entries=meaningful.filter(v=>v.fields[key]).map(v=>v.fields[key]);fields[key]=entries.length===1?entries[0]:combine(entries,union);}
  const required=union?new Set([...meaningful[0].required].filter(k=>meaningful.every(v=>v.required.has(k)))):new Set(meaningful.flatMap(v=>[...v.required]));
  const object=meaningful.every(v=>v.kind==='object');return {kind:object?'object':meaningful.length===1?meaningful[0].kind:'union',label:object?(labels.length===1?labels[0]:'JSON_object'):labels.join(union?'_or_':'_and_'),fields,required};
 }
 return {describe:(schema,doc)=>info(schema,doc),warnings};
}
