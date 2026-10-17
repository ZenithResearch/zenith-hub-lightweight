import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const provenance=JSON.parse(await readFile('profiles/source-provenance.json','utf8'));
for(const component of provenance)for(const file of component.files){
 if(createHash('sha256').update(await readFile(file.path)).digest('hex')!==file.sha256)throw Error('Source hash differs: '+file.path);
}
console.log('Imported controller, profile and UI source hashes match.');
