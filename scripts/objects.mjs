/** Owner-side Hub object storage. This CLI does not start or configure any provider. */
import {exportBundle,importBundle} from '../src/lib/objects/bundle.mjs';
import path from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import {ObjectStore} from '../src/lib/objects/store.mjs';
import {loadOntologyRegistry} from '../src/lib/objects/registry.mjs';
const readText = async file => new TextDecoder('utf-8', {fatal: true}).decode(await readFile(file));
const [operation, ...raw] = process.argv.slice(2), flags = {};
const allowed = new Set(['--data-dir', '--registry', '--input', '--output', '--import-key', '--expected-revisions', '--projections', '--source', '--id', '--type', '--graph', '--depth', '--limit', '--after','--admission','--include-subclasses','--expected-bundle-sha256']);
let store;
try {
  for (let i = 0; i < raw.length; i += 2) {
    if (!allowed.has(raw[i]) || !raw[i + 1] || Object.hasOwn(flags, raw[i])) throw Error('Expected unique supported flag/value pairs');
    flags[raw[i]] = raw[i + 1];
  }
  if (!['init','registry','import','export','get','list','relationships','connected','rebuild-indexes','export-bundle','import-bundle'].includes(operation)) throw Error('Unknown object operation');
  const operationFlags = {init: [], registry: [], list: ['--type','--after','--limit','--include-subclasses'],
    get: ['--id'], relationships: ['--id','--limit'], connected: ['--id','--depth','--limit'],
    'rebuild-indexes': [], import: ['--input','--import-key','--expected-revisions','--projections','--source','--admission'],
    'import-bundle':['--input','--import-key','--expected-revisions','--source','--expected-bundle-sha256'],
    'export-bundle':['--id','--graph'],
    export: ['--id','--graph']};
  if(flags['--include-subclasses']!==undefined&&!['true','false'].includes(flags['--include-subclasses']))throw Error('Use true or false for --include-subclasses');
  const permitted = ['--data-dir','--registry','--output', ...operationFlags[operation]];
  if (Object.keys(flags).some(key => !permitted.includes(key))) throw Error('Flag does not apply to this operation');
  if (flags['--id'] && flags['--graph']) throw Error('Select objects or a graph, not both');
  const directory = flags['--data-dir'] || process.env.ZENITH_HUB_DATA_DIR;
  if (!directory && operation !== 'registry') throw Error('Select an absolute --data-dir owned by Hub');
  const registry = await loadOntologyRegistry(flags['--registry'] || process.env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE || path.join(process.cwd(), 'profiles/object-store/registry.json'));
  if (operation !== 'registry') store = new ObjectStore({dataDir: directory, registry});
  let value;
  if (operation === 'init') value = {initialized: true, database: path.join(directory, 'objects.sqlite'), registry: registry.describe()};
  else if (operation === 'registry') value = registry.describe();
  else if (operation === 'list') value = store.list({...(flags['--type'] ? {type: flags['--type']} : {}), includeSubclasses:flags['--include-subclasses']==='true', after: flags['--after'] || '', limit: Number(flags['--limit'] ?? 100)});
  else if (operation === 'get') value = await store.get(flags['--id']);
  else if (operation === 'relationships') value = store.relationships({id: flags['--id'], limit: Number(flags['--limit'] ?? 1000)});
  else if (operation === 'connected') value = store.connected({id: flags['--id'], depth: Number(flags['--depth'] ?? 1), limit: Number(flags['--limit'] ?? 100)});
  else if (operation === 'rebuild-indexes') value = store.rebuildIndexes();
  else if (operation === 'import-bundle') value=await importBundle(store,JSON.parse(await readText(flags['--input'])),{importKey:flags['--import-key'],expectedBundleSha256:flags['--expected-bundle-sha256'],expectedRevisions:flags['--expected-revisions']?JSON.parse(await readText(flags['--expected-revisions'])):{},source:flags['--source']||null});
  else if (operation === 'export-bundle') value=await exportBundle(store,flags['--id']?{ids:[flags['--id']]}:flags['--graph']?{graph:flags['--graph']}:{});
  else if (operation === 'import') {
    if (!flags['--input'] || !flags['--import-key']) throw Error('Import requires --input and --import-key');
    value = await store.importDocument(await readText(flags['--input']), {importKey: flags['--import-key'], ...(flags['--admission']?{admission:flags['--admission']}:{}), source: flags['--source'] || null,
      expectedRevisions: flags['--expected-revisions'] ? JSON.parse(await readText(flags['--expected-revisions'])) : {},
      projections: flags['--projections'] ? JSON.parse(await readText(flags['--projections'])) : {}});
  } else if (operation === 'export') value = await store.exportDocument(flags['--id'] ? {ids: [flags['--id']]} : flags['--graph'] ? {graph: flags['--graph']} : {});
  else throw Error('Use init, registry, import, export, get, list, relationships, connected or rebuild-indexes');
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (flags['--output']) await writeFile(flags['--output'], serialized, {flag: 'wx', mode: 0o600});
  else process.stdout.write(serialized);
} catch (error) {
  process.stderr.write(JSON.stringify({error: error.code || error.message, details: error.details,
    ...(['import','import-bundle'].includes(operation) ? {created: [], updated: [], alreadyPresent: [], rejected: 'entire_batch', committed: false} : {})}) + '\n');
  process.exitCode = 1;
} finally {store?.close();}
