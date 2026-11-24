/** Generate code-native diagrams from the verified declarations; no layout-derived inheritance. */
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {loadOntologyRegistry} from '../src/lib/objects/registry.mjs';
const r=await loadOntologyRegistry('profiles/object-store/registry.json');
const Z='https://zenith-research.ca/ontology/terms/',I='https://zenith-research.ca/ontology/hub/infrastructure/terms/',T='http://www.w3.org/2002/07/owl#Thing';
const short=id=>id.startsWith(Z)?'zn:'+id.slice(Z.length):id.startsWith(I)?'infra:'+id.slice(I.length):'owl:Thing';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function canvas(w,h,title,subtitle){return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="#788a83"/></marker></defs><style>text{font-family:Arial,sans-serif;fill:#283832} .label{font-size:16px;font-weight:600}.small{font-size:12px;fill:#64746b} .edge{fill:none;stroke:#83938a;stroke-width:1.5;marker-end:url(#arrow)} .dashed{stroke-dasharray:5 4}</style><rect width="100%" height="100%" fill="white"/><text x="38" y="42" style="font-size:25px;font-weight:600">${esc(title)}</text><text x="38" y="70" class="small">${esc(subtitle)}</text>`];}
function box(out,x,y,w,h,title,sub,color='#f1f3f2') {out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${color}" stroke="#cdd6cf"/><text x="${x+w/2}" y="${y+h/2-2}" text-anchor="middle" class="label">${esc(title)}</text>${sub?`<text x="${x+w/2}" y="${y+h/2+19}" text-anchor="middle" class="small">${esc(sub)}</text>`:''}`);}
function path(out,d,label,x,y,dashed=false){out.push(`<path d="${d}" class="edge${dashed?' dashed':''}"/>`);if(label)out.push(`<text x="${x}" y="${y}" class="small">${esc(label)}</text>`);}
const groups=[
 ['Participant identities',[[Z+'Entity',0],[Z+'Person',1],[Z+'Organization',1],[Z+'Agent',1],[I+'ServiceInstance',2],[I+'Machine',1]]],
 ['Information and evidence',[[Z+'Artifact',0],[Z+'Receipt',1],[Z+'CasePlan',1],[Z+'ContactInformation',1],[Z+'DirectoryEntry',2],[Z+'Handoff',1],[Z+'Request',1]]],
 ['Logical collections',[[Z+'Collection',0],[Z+'Directory',1],[Z+'Inbox',1],[Z+'Outbox',1],[Z+'EncryptedOutbox',2],[Z+'StatusSet',1]]],
 ['Work',[[Z+'Todo',0],[Z+'Initiative',1],[Z+'Issue',1],[Z+'Project',1],[Z+'Proposal',1],[Z+'Task',1]]],
 ['Other Core foundations',[]],['Infrastructure foundations',[[I+'Deployment',0],[I+'Network',0],[I+'NetworkInterface',0],[I+'StorageVolume',0],[I+'DNSZone',0]]]];
const assigned=new Set(groups.flatMap(g=>g[1].map(n=>n[0])));
groups[4][1]=[...r.types.keys()].filter(id=>!assigned.has(id)).sort().map(id=>[id,0]);
const out=canvas(2220,1570,'Class inheritance — Core + proposed Hub Infrastructure','Parent → subclass. Grey: existing normalized Zenith 0.1.0. Green: proposed infrastructure. Dashed owl:Thing edge: implicit universal root, not a stored assertion.');
const nodes=new Map();box(out,1005,105,220,64,'owl:Thing','existing OWL foundation','#efedf5');nodes.set(T,{x:1005,y:105,w:220,h:64});
for(let column=0;column<groups.length;column++) {
 const x=column*365+25;out.push(`<rect x="${x}" y="218" width="350" height="1265" fill="none" stroke="#e4e9e5"/><text x="${x+175}" y="244" text-anchor="middle" class="label">${esc(groups[column][0])}</text>`);
 groups[column][1].forEach(([id,depth],index)=>nodes.set(id,{x:x+34+depth*12,y:280+index*101,w:270-depth*12,h:66,column,depth}));
}
for(const [id,n]of nodes)if(id!==T){const parents=[...(r.moduleGraph.parents.get(id)||[])],implicit=!parents.length;
 for(const parent of implicit?[T]:parents){const p=nodes.get(parent);if(!p)throw Error('Diagram parent missing: '+parent);
  if(parent===T){const bus=25+n.column*365+12;path(out,`M1115 169V190H${bus}V${n.y+33}H${n.x}`,null,0,0,implicit);}
  else {const bus=25+n.column*365+19+n.depth*4;path(out,`M${p.x} ${p.y+33}H${bus}V${n.y+33}H${n.x}`,null,0,0);}
 }}
for(const [id,n]of nodes)if(id!==T)box(out,n.x,n.y,n.w,n.h,short(id),id.startsWith(I)?'Hub / infrastructure · proposed':'normalized Zenith · existing',id.startsWith(I)?'#e3f2e7':'#f1f3f2');
out.push('<text x="38" y="1517" class="small">Core Actor declares owl:equivalentClass Entity. That equivalence is preserved upstream and is not expanded by the rdfs:subClassOf query.</text><text x="38" y="1542" class="small">Entity descendants inherit Addressable/Invocable conformance; Core EntityProjection and implementation bindings remain separate schema structures.</text></svg>');
await mkdir('docs/infrastructure',{recursive:true});await writeFile('docs/infrastructure/inheritance.svg',out.join('\n'));
const diagram=canvas(1510,1050,'Modules and domains — verified offline imports','Import arrows: importer → dependency. Instance/schema links are dashed and are not inheritance. All identifiers are proposals; no website publication is performed.');
diagram.push('<rect x="25" y="100" width="535" height="860" fill="#fafbfa" stroke="#dbe2dc"/><text x="45" y="128" class="label">Existing normalized Zenith · 0.1.0</text>');
const core='https://zenith-research.ca/ontology/normalized/v0.1.0/',coreNodes=new Map();
const coreMods=r.moduleGraph.describe().filter(m=>m.package==='https://zenith-research.ca/ontology/normalized');
for(let i=0;i<coreMods.length;i++){const m=coreMods[i],name=m.versionIri===core+'ontology.jsonld'?'Root ontology':m.versionIri.split('/').at(-1).replace('.jsonld','');coreNodes.set(m.versionIri,{x:70,y:165+i*103,w:390,h:67,name});}
for(const m of coreMods)for(const imported of m.imports){const p=coreNodes.get(m.versionIri),q=coreNodes.get(r.moduleGraph.modules.has(imported)?imported:r.moduleGraph.describe().find(v=>v.ontologyId===imported)?.versionIri);if(!q)continue;const bus=m.versionIri===core+'ontology.jsonld'?48:495;path(diagram,`M${p.x+(bus>p.x?p.w:0)} ${p.y+33}H${bus}V${q.y+33}H${q.x+(bus>q.x?q.w:0)}`,null,0,0);}
for(const n of coreNodes.values())box(diagram,n.x,n.y,n.w,n.h,n.name,'verified module · exact published bytes');
const cm=coreNodes.get(core+'modules/core.jsonld');box(diagram,745,205,680,120,'Hub Infrastructure · proposed 0.1.0','ontology/hub/infrastructure · 7 new classes','#e3f2e7');
path(diagram,`M745 265H650V${cm.y+33}H${cm.x+cm.w}`,'owl:imports · exact Core 0.1.0 hash pins',610,180);
box(diagram,745,440,680,110,'Infrastructure domain','instance of existing zn:Domain · hub/infrastructure','#e3f2e7');
path(diagram,'M940 440V325','sourceModuleRef · versioned module',780,392,true);
path(diagram,'M1260 440V325','vocabularyRef · canonical identity',1120,371,true);
box(diagram,745,660,680,115,'Schemas and implementation bindings','Core EntityProjection + infrastructure shapes + portable bindings','#efedf5');
path(diagram,'M1085 660V595H1465V345H1345V325','module-owned schemas; not inheritance',810,625,true);
box(diagram,745,840,680,80,'zn:Domain — existing Core class','Infrastructure is an instance; Domain is not a superclass of infrastructure objects');
path(diagram,'M1425 495H1490V880H1425','rdf:type',1438,815,true);
const domains=JSON.parse(await readFile('profiles/object-store/ontology/zenith-0.1.0/domains.json','utf8'));
diagram.push(`<text x="45" y="990" class="small">Existing domains: ${esc(domains.map(d=>d.key).join(' · '))}</text><text x="45" y="1018" class="small">Module verification requires complete local imports and parent declarations; a cached context or schema is not a verified ontology module.</text></svg>`);
await writeFile('docs/infrastructure/modules.svg',diagram.join('\n'));
console.log('Rendered all '+r.types.size+' declared classes and '+r.moduleGraph.modules.size+' verified modules.');
