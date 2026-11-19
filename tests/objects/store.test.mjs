import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, chmod, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import jsonld from 'jsonld';
import {DatabaseSync} from 'node:sqlite';
import {ObjectStore} from '../../src/lib/objects/store.mjs';
import {loadOntologyRegistry} from '../../src/lib/objects/registry.mjs';
const registry = await loadOntologyRegistry('profiles/object-store/registry.json');
export const Z = 'https://zenith-research.ca/ontology/terms/';
const R = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const L = 'http://www.w3.org/2000/01/rdf-schema#';
const X = 'http://www.w3.org/2001/XMLSchema#';
const context = {zn: Z, rdf: R, rdfs: L, xsd: X};
const artifact = (id, label = 'Original') => ({'@context': context, '@id': id, '@type': 'zn:Artifact', 'rdfs:label': label});
async function canonical(document) {return jsonld.canonize(document, {algorithm: 'RDFC-1.0', safe: true});}
async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hub-object-test-'));
  const root = await realpath(temporary); await chmod(root, 0o700);
  const stores = [];
  t.after(() => {for (const s of stores) {try {s.close();} catch {}} return rm(root, {recursive: true, force: true});});
  const open = name => {const s = new ObjectStore({dataDir: path.join(root, name), registry}); stores.push(s); return s;};
  return {root, open, s: open('first')};
}
const connectedFixture = {
  '@context': context,
  '@graph': [
    {'@id': 'urn:hub:catalog', '@type': 'zn:Collection',
      'zn:HAS_ARTIFACT': [{'@id': 'urn:hub:config'}, {'@id': 'https://example.org/not-local'}],
      'rdfs:label': [{'@value': 'Catalogue', '@language': 'fr'}, {'@value': 'Catalog', '@language': 'en'}],
      'rdf:value': {'@list': [{'@value': '2', '@type': 'xsd:integer'}, {'@value': '3.50', '@type': 'xsd:decimal'}]}},
    {'@id': 'urn:hub:config', '@type': 'zn:Artifact', 'rdf:value': {'@id': '_:details'}},
    {'@id': '_:details', 'rdfs:label': 'Anonymous retained details'},
    {'@id': 'urn:hub:observations', '@graph': [{'@id': 'urn:hub:config', 'rdfs:label': 'Named-graph description'}]},
  ],
};
test('semantic acceptance: import, close/reopen, export, fresh-store import and export preserve the RDF dataset', async t => {
  const {s, open} = await fixture(t);
  const first = await s.importDocument(JSON.stringify(connectedFixture), {importKey: 'connected', source: 'isolated-test'});
  assert.deepEqual(first.created, ['urn:hub:catalog', 'urn:hub:config']);
  assert.equal(s.relationships({id: 'urn:hub:catalog'}).items.some(v => v.target === 'https://example.org/not-local'), true);
  s.close();
  const reopened = open('first');
  assert.equal((await reopened.get('urn:hub:config')).revision, 1);
  const exported = await reopened.exportDocument();
  assert.equal(await canonical(connectedFixture), await canonical(exported));
  const fresh = open('fresh');
  await fresh.importDocument(exported, {importKey: 'from-first-store'});
  const twice = await fresh.exportDocument();
  assert.equal(await canonical(exported), await canonical(twice));
  assert.equal(await canonical(connectedFixture), await canonical(twice));
  assert.ok(!JSON.stringify(twice).includes('importKey'));
  assert.ok(!JSON.stringify(twice).includes('isolated-test'));
});
test('expanded, compacted and prefix/order variants are semantically already present; byte hashes differ', async t => {
  const {s} = await fixture(t);
  const a = {'@context': context, '@id': 'urn:hub:a', '@type': 'zn:Artifact', 'rdfs:label': ['a', 'b']};
  const b = {'@context': {ontology: Z, name: L + 'label'}, name: ['b', 'a'], '@type': 'ontology:Artifact', '@id': 'urn:hub:a'};
  const first = await s.importDocument(a, {importKey: 'first'});
  const repeat = await s.importDocument(b, {importKey: 'second'});
  assert.deepEqual(repeat.alreadyPresent, ['urn:hub:a']);
  assert.equal(first.semanticSha256, repeat.semanticSha256);
  assert.notEqual(first.contentSha256, repeat.contentSha256);
  const expanded = await jsonld.expand(a);
  assert.deepEqual((await s.importDocument(expanded, {importKey: 'third'})).alreadyPresent, ['urn:hub:a']);
  const replay = await s.importDocument(b, {importKey: 'first'});
  assert.equal(replay.replayed, true);
  assert.equal((await s.get('urn:hub:a')).revision, 1);
});
test('ordered lists remain ordered and a reversed list is a conflicting change', async t => {
  const {s} = await fixture(t);
  const a = {...artifact('urn:list'), 'rdf:value': {'@list': ['one', 'two']}};
  const b = {...artifact('urn:list'), 'rdf:value': {'@list': ['two', 'one']}};
  await s.importDocument(a, {importKey: 'a'});
  assert.notEqual(await canonical(a), await canonical(b));
  await assert.rejects(s.importDocument(b, {importKey: 'b'}), {code: 'expected_revision_required'});
  assert.equal(await canonical(a), await canonical(await s.exportDocument()));
});
test('typed literals and language tags survive without native-number coercion', async t => {
  const {s} = await fixture(t);
  const doc = {...artifact('urn:literals'), 'rdf:value': [
    {'@value': '0007', '@type': 'xsd:integer'}, {'@value': 'bonjour', '@language': 'fr'},
    {'@value': '2026-11-19', '@type': 'xsd:date'}, {'@value': '3.50', '@type': 'xsd:decimal'}]};
  await s.importDocument(doc, {importKey: 'literals'});
  const result = await s.exportDocument();
  assert.equal(await canonical(doc), await canonical(result));
  assert.ok(result[0][R + 'value'].some(v => v['@value'] === '0007' && v['@type'] === X + 'integer'));
});
test('same blank-node labels in separate imports do not alias', async t => {
  const {s} = await fixture(t);
  for (const [id, label] of [['urn:one', 'red'], ['urn:two', 'blue']]) {
    await s.importDocument({'@context': context, '@graph': [
      {'@id': id, '@type': 'zn:Artifact', 'rdf:value': {'@id': '_:same'}},
      {'@id': '_:same', 'rdfs:label': label},
    ]}, {importKey: id});
  }
  const expanded = await s.exportDocument();
  const targets = expanded.filter(n => n['@id'].startsWith('urn:')).map(n => n[R + 'value'][0]['@id']);
  assert.equal(new Set(targets).size, 2);
  assert.equal(expanded.filter(n => n['@id'].startsWith('_:')).length, 2);
});
test('shared blank nodes preserve identity; partial unit updates reject and complete CAS updates work', async t => {
  const {s} = await fixture(t);
  const make = label => ({'@context': context, '@graph': [
    {'@id': 'urn:a', '@type': 'zn:Artifact', 'rdf:value': {'@id': '_:shared'}},
    {'@id': 'urn:b', '@type': 'zn:Artifact', 'rdf:value': {'@id': '_:shared'}},
    {'@id': '_:shared', 'rdfs:label': label},
  ]});
  await s.importDocument(make('before'), {importKey: 'shared'});
  assert.equal((await s.get('urn:a')).atomicUnit.length, 2);
  assert.deepEqual(s.connected({id: 'urn:a', depth: 0}).ids, ['urn:a', 'urn:b']);
  await assert.rejects(s.importDocument(artifact('urn:a', 'after'), {importKey: 'partial', expectedRevisions: {'urn:a': 1}}), {code: 'connected_update_requires_complete_unit'});
  const result = await s.importDocument(make('after'), {importKey: 'whole', expectedRevisions: {'urn:a': 1, 'urn:b': 1}});
  assert.deepEqual(result.updated, ['urn:a', 'urn:b']);
  assert.equal((await s.get('urn:a')).revision, 2);
  assert.equal(await canonical(make('after')), await canonical(await s.exportDocument()));
});
test('blank-only imports are repeatable by import key and isolated under distinct keys', async t => {
  const {s} = await fixture(t), doc = {'@context': context, '@id': '_:x', 'rdfs:label': 'Anonymous'};
  await s.importDocument(doc, {importKey: 'one'});
  await s.importDocument(doc, {importKey: 'one'});
  assert.equal((await s.exportDocument()).length, 1);
  await s.importDocument(doc, {importKey: 'two'});
  assert.equal((await s.exportDocument()).length, 2);
});
test('named and blank graph boundaries survive full export and fresh reimport', async t => {
  const {s, open} = await fixture(t);
  const doc = {'@context': context, '@graph': [
    {'@id': 'urn:a', '@type': 'zn:Artifact'},
    {'@id': 'urn:graph', '@graph': [{'@id': 'urn:a', 'rdfs:label': 'Named'}]},
    {'@id': '_:graph', '@graph': [{'@id': 'urn:a', 'rdf:value': 'Blank graph'}]},
  ]};
  await s.importDocument(doc, {importKey: 'graphs'});
  const output = await s.exportDocument(), fresh = open('graphs');
  await fresh.importDocument(output, {importKey: 'graphs-again'});
  assert.equal(await canonical(doc), await canonical(await fresh.exportDocument()));
  const selected = await s.exportDocument({graph: 'urn:graph'});
  assert.equal(await canonical(selected), await canonical({'@context': context, '@id': 'urn:graph', '@graph': [{'@id': 'urn:a', 'rdfs:label': 'Named'}]}));
  const selectedStore = open('selected');
  await selectedStore.importDocument(selected, {importKey: 'partial-graph'});
  assert.equal(await canonical(selected), await canonical(await selectedStore.exportDocument()));
  assert.equal((await selectedStore.get('urn:a')).validation.typeRecognition, 'untyped-description');
});
test('invalid batch or a conflict cannot leave new objects or partial indexes behind', async t => {
  const {s} = await fixture(t);
  await s.importDocument(artifact('urn:old'), {importKey: 'old'});
  const before = await canonical(await s.exportDocument());
  await assert.rejects(s.importDocument([artifact('urn:new'), artifact('urn:old', 'Changed')], {importKey: 'conflict'}), {code: 'expected_revision_required'});
  assert.deepEqual(s.list().items.map(v => v.id), ['urn:old']);
  assert.equal(await canonical(await s.exportDocument()), before);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM imports').get().n, 1);
  await assert.rejects(s.importDocument([artifact('urn:new'), {'@context': context, '@id': 'urn:bad', '@type': 'zn:NotReleased'}], {importKey: 'bad-type'}), {code: 'unrecognized_ontology_type'});
  assert.equal(s.list().items.length, 1);
});
test('explicit create/update semantics and stale revisions are enforced across independent connections', async t => {
  const {s, open} = await fixture(t);
  await s.importDocument(artifact('urn:a'), {intent: 'create', objectId: 'urn:a', importKey: 'create'});
  await assert.rejects(s.importDocument(artifact('urn:a'), {intent: 'create', objectId: 'urn:a', importKey: 'duplicate'}), {code: 'object_already_exists'});
  const other = open('first');
  const changes = await Promise.allSettled([s, other].map((store, i) => store.importDocument(artifact('urn:a', String(i)),
    {intent: 'update', objectId: 'urn:a', expectedRevisions: {'urn:a': 1}, importKey: 'update-' + i})));
  assert.equal(changes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(changes.find(r => r.status === 'rejected').reason.code, 'stale_revision');
  assert.equal((await s.get('urn:a')).revision, 2);
});
test('import identity binds meaning and repeat imports never silently overwrite later work', async t => {
  const {s} = await fixture(t);
  await s.importDocument(artifact('urn:a'), {importKey: 'create'});
  await assert.rejects(s.importDocument(artifact('urn:a', 'different'), {importKey: 'create'}), {code: 'import_key_conflict'});
  await s.importDocument(artifact('urn:a', 'updated'), {importKey: 'update', expectedRevisions: {'urn:a': 1}});
  assert.equal((await s.importDocument(artifact('urn:a'), {importKey: 'create'})).replayed, true);
  assert.equal((await s.get('urn:a')).revision, 2);
});
test('unsupported contexts, malformed JSON, lossy keywords and relative/unknown terms reject atomically', async t => {
  const {s} = await fixture(t);
  for (const [document, code] of [
    ['{', 'invalid_json'],
    [{'@context': 'https://unregistered.invalid/context', '@id': 'urn:x', '@type': Z + 'Artifact'}, 'unsupported_context'],
    [{'@context': 'file:///etc/passwd', '@id': 'urn:x', '@type': Z + 'Artifact'}, 'unsupported_context'],
    [{...artifact('urn:x'), '@index': 'not-rdf'}, 'unsupported_jsonld_feature'],
    [{...artifact('urn:x'), 'rdf:value': {'@value': 'hello', '@direction': 'ltr'}}, 'unsupported_jsonld_feature'],
    [{'@id': 'urn:empty', '@graph': []}, 'empty_named_graph_unsupported'],
  ]) await assert.rejects(s.importDocument(document, {importKey: 'invalid-' + code}), {code});
  assert.equal(s.list().items.length, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM imports').get().n, 0);
  await assert.rejects(s.importDocument({'@id': 'relative', '@type': Z + 'Artifact'}, {importKey: 'relative'}));
});
test('registered pinned contexts are loaded offline and their digests enter import provenance', async t => {
  const {s} = await fixture(t);
  const contextURL = 'https://zenith-research.ca/ontology/normalized/v0.1.0/modules/core.jsonld';
  await s.importDocument({'@context': contextURL, '@id': 'urn:pinned', '@type': 'zn:Artifact', label: 'Pinned'}, {importKey: 'pinned'});
  const record = await s.get('urn:pinned');
  assert.equal(record.provenance.contexts[0].url, contextURL);
  assert.match(record.provenance.contexts[0].sha256, /^[a-f0-9]{64}$/);
});
test('EntityProjection validates its exact closed fragment and never gains storage metadata', async t => {
  const {s} = await fixture(t), id = 'urn:person', profile = [...registry.profiles.keys()][0];
  const doc = {...artifact(id), '@type': 'zn:Person'};
  const valid = {id, types: [Z + 'Person'], invocationContract: {id: 'urn:contract', sha256: 'a'.repeat(64), byteLength: 7, mediaType: 'application/ld+json'}};
  for (const value of [{id, types: [Z + 'Person']}, {...valid, machine: 'unexpected'}]) {
    await assert.rejects(s.importDocument(doc, {importKey: 'invalid-profile', projections: {[id]: [{profile, value}]}}), {code: 'schema_validation_failed'});
  }
  await s.importDocument(doc, {importKey: 'valid-profile', projections: {[id]: [{profile, value: valid}]}});
  const record = await s.get(id);
  assert.deepEqual(record.projections[0].value, valid);
  assert.equal(record.validation.invocationConformance, 'not-assessed');
  assert.equal(await canonical(record.document), await canonical(doc));
});
test('derived relationship/type indexes rebuild from canonical assertions and update removes old links', async t => {
  const {s} = await fixture(t);
  const a = {...artifact('urn:a'), 'zn:HAS_ARTIFACT': {'@id': 'urn:external:old'}};
  await s.importDocument(a, {importKey: 'first'});
  s.db.exec('DELETE FROM object_links; DELETE FROM object_types;');
  s.rebuildIndexes();
  assert.equal(s.list({type: Z + 'Artifact'}).items.length, 1);
  assert.ok(s.relationships({id: 'urn:a'}).items.some(v => v.target === 'urn:external:old'));
  await s.importDocument({...a, 'zn:HAS_ARTIFACT': {'@id': 'urn:external:new'}}, {importKey: 'second', expectedRevisions: {'urn:a': 1}});
  assert.equal(s.relationships({id: 'urn:a'}).items.some(v => v.target === 'urn:external:old'), false);
});
test('list, incoming links, connected sets and object selection preserve external references', async t => {
  const {s} = await fixture(t);
  await s.importDocument(connectedFixture, {importKey: 'connected'});
  assert.deepEqual(s.connected({id: 'urn:hub:catalog'}).ids, ['urn:hub:catalog', 'urn:hub:config']);
  assert.deepEqual(s.connected({id: 'urn:hub:catalog'}).externalReferences, ['https://example.org/not-local']);
  assert.ok(s.relationships({id: 'urn:hub:config', direction: 'incoming'}).items.some(v => v.subject === 'urn:hub:catalog'));
  const page = s.list({limit: 1}); assert.equal(page.items.length, 1);
  assert.equal(s.list({limit: 1, after: page.next}).items.length, 1);
  await assert.rejects(s.get('urn:not-local'), {code: 'object_not_found'});
  const selected = await s.exportDocument({ids: ['urn:hub:catalog']});
  assert.equal(selected.some(v => v['@id'] === 'urn:hub:config'), false);
  assert.ok(JSON.stringify(selected).includes('https://example.org/not-local'));
});
test('unrelated SQLite databases are rejected before mutation and filesystem links are refused', async t => {
  const {root} = await fixture(t);
  const directory = path.join(root, 'foreign'); await import('node:fs/promises').then(fs => fs.mkdir(directory, {mode: 0o700}));
  const file = path.join(directory, 'objects.sqlite'), foreign = new DatabaseSync(file);
  foreign.exec('CREATE TABLE foreign_data(id INTEGER); INSERT INTO foreign_data VALUES(7)'); foreign.close();
  await chmod(file, 0o600); const before = await readFile(file);
  assert.throws(() => new ObjectStore({dataDir: directory, registry}), {code: 'not_a_supported_hub_database'});
  assert.deepEqual(await readFile(file), before);
});

test('a mid-write failure rolls back assertions, receipts and derived indexes together', async t => {
  const {s} = await fixture(t), original = s.index.bind(s);
  let writes = 0;
  s.index = unit => {original(unit); if (++writes === 2) throw Error('injected write failure');};
  await assert.rejects(s.importDocument([artifact('urn:a'), artifact('urn:b')], {importKey: 'rollback'}), /injected write failure/);
  for (const table of ['units','objects','imports','object_types','object_links']) assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});
test('unsafe native JSON numbers reject; exact large typed literal strings survive', async t => {
  const {s} = await fixture(t);
  await assert.rejects(s.importDocument({...artifact('urn:number'), 'rdf:value': 9007199254740992}, {importKey: 'unsafe'}), {code: 'unsafe_json_number'});
  const doc = {...artifact('urn:number'), 'rdf:value': {'@value': '9007199254740993', '@type': 'xsd:integer'}};
  await s.importDocument(doc, {importKey: 'safe'});
  assert.equal(await canonical(doc), await canonical(await s.exportDocument()));
});

test('several descriptions of one IRI in a document union assertions rather than overwrite', async t => {
  const {s} = await fixture(t);
  const doc = [artifact('urn:one', 'first'), artifact('urn:one', 'second')];
  const result = await s.importDocument(doc, {importKey: 'descriptions'});
  assert.deepEqual(result.created, ['urn:one']);
  const exported = await s.exportDocument();
  assert.equal(exported[0][L + 'label'].length, 2);
  assert.equal(await canonical(doc), await canonical(exported));
});
