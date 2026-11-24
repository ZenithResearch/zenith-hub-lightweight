/** Ephemeral compatibility projection over a verified repository snapshot, never another durable inventory. */
import {ObjectStore} from './store.mjs';
import {sha256} from './registry.mjs';
export function readModel(snapshot,validation,registry) {
  const store=new ObjectStore({registry,memory:true}),selected=new Map(snapshot.selectedObjects.map(v=>[v.objectId,v.objectRevision]));
  store.db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?)').run('foundation-seed','seed','seed','seed',JSON.stringify({source:'hub-repository',importedAt:new Date(0).toISOString()}),'{}');
  for(const unit of snapshot.selectedUnits){const key=JSON.stringify([unit.id,unit.revision]),source=snapshot.rdfUnits.find(u=>JSON.stringify([u.id,u.revision])===key),id=sha256(key);const entry=[...validation.entries.values()].find(e=>JSON.stringify(e.object.atomicUnit)===JSON.stringify(unit));
    const nquads=entry?.canonical||validation.unitCanonical?.get(key);store.db.prepare('INSERT INTO units VALUES(?,?,?)').run(id,nquads,source.semanticSha256);
    for(const member of source.members){const revision=selected.get(member),record=validation.entries.get(member+'|'+revision);store.db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?)').run(member,id,revision,new Date(0).toISOString(),'foundation-seed',JSON.stringify(record.file.bindings));}
    for(const member of source.members){const record=validation.entries.get(member+'|'+selected.get(member));if(record.object.admission!=='observation')store.db.prepare('INSERT INTO admissions VALUES(?,?)').run(member,record.object.admission);}
    store.index({id,nquads});
  }
  return store;
}
