/** Generate/check only the legacy compatibility mirror. cms/ + release contracts are the maintained inputs. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadApplicationDefinitions} from '../src/lib/objects/application.mjs';
import {readPackage} from '../src/lib/catalog/package.mjs';
const definitions=await loadApplicationDefinitions({}),candidate=await readPackage({definitions,registry:definitions.registry});
const file='profiles/setup/catalog.json',before=JSON.parse(await fs.readFile(file));
if(process.argv.includes('--write')){try{assert.deepEqual(before,candidate.catalog);}catch{await fs.writeFile(file,JSON.stringify(candidate.catalog,null,2)+'\n');}}
else assert.deepEqual(before,candidate.catalog,'Regenerate profiles/setup/catalog.json with npm run catalog:generate; it is not an editable authority.');
console.log(JSON.stringify({version:candidate.version,packageId:candidate.id,software:candidate.software.size,recipes:candidate.recipes.size,compatibility:'verified',mode:process.argv.includes('--write')?'generate':'check'}));
