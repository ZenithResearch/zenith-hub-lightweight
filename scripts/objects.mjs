/** Owner-side Hub object storage. This CLI does not start or configure any provider. */
import path from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import {ObjectStore} from '../src/lib/objects/store.mjs';
import {loadOntologyRegistry} from '../src/lib/objects/registry.mjs';
const readText = async file => new TextDecoder('utf-8', {fatal: true}).decode(await readFile(file));
const [operation, ...raw] = process.argv.slice(2), flags = {};
const allowed = new Set(['--data-dir', '--registry', '--input', '--output', '--import-key', '--expected-revisions', '--projections', '--source', '--id', '--type', '--graph', '--depth', '--limit', '--after']);
let store;
try {
  for (let i = 0; i < raw.length; i += 2) {
    if (!allowed.has(raw[i]) || !raw[i + 1] || Object.hasOwn(flags, raw[i])) throw Error('Expected unique supported flag/value pairs');
    flags[raw[i]] = raw[i + 1];
  }
  if (!['init','registry','import','export','get','list','relationships','connected','rebuild-indexes'].includes(operation)) throw Error('Unknown object operation');
  const operationFlags = {init: [], registry: [], list: ['--type','--after','--limit'],
    get: ['--id'], relationships: ['--id','--limit'], connected: ['--id','--depth','--limit'],
    'rebuild-indexes': [], import: ['--input','--import-key','--expected-revisions','--projections','--source'],
    export: ['--id','--graph']};
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
  else if (operation === 'list') value = store.list({...(flags['--type'] ? {type: flags['--type']} : {}), after: flags['--after'] || '', limit: Number(flags['--limit'] ?? 100)});
  else if (operation === 'get') value = await store.get(flags['--id']);
  else if (operation === 'relationships') value = store.relationships({id: flags['--id'], limit: Number(flags['--limit'] ?? 1000)});
  else if (operation === 'connected') value = store.connected({id: flags['--id'], depth: Number(flags['--depth'] ?? 1), limit: Number(flags['--limit'] ?? 100)});
  else if (operation === 'rebuild-indexes') value = store.rebuildIndexes();
  else if (operation === 'import') {
    if (!flags['--input'] || !flags['--import-key']) throw Error('Import requires --input and --import-key');
    value = await store.importDocument(await readText(flags['--input']), {importKey: flags['--import-key'], source: flags['--source'] || null,
      expectedRevisions: flags['--expected-revisions'] ? JSON.parse(await readText(flags['--expected-revisions'])) : {},
      projections: flags['--projections'] ? JSON.parse(await readText(flags['--projections'])) : {}});
  } else if (operation === 'export') value = await store.exportDocument(flags['--id'] ? {ids: [flags['--id']]} : flags['--graph'] ? {graph: flags['--graph']} : {});
  else throw Error('Use init, registry, import, export, get, list, relationships, connected or rebuild-indexes');
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (flags['--output']) await writeFile(flags['--output'], serialized, {flag: 'wx', mode: 0o600});
  else process.stdout.write(serialized);
} catch (error) {
  process.stderr.write(JSON.stringify({error: error.code || error.message, details: error.details,
    ...(operation === 'import' ? {created: [], updated: [], alreadyPresent: [], rejected: 'entire_batch', committed: false} : {})}) + '\n');
  process.exitCode = 1;
} finally {store?.close();}
