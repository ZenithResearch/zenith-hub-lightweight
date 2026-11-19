import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectController} from '../../src/lib/objects/controller.mjs';
import {ObjectStore} from '../../src/lib/objects/store.mjs';
const origin = 'http://127.0.0.1:4208';
const env = {ZENITH_LOCAL_OPERATOR: '1', ZENITH_HUB_DATA_DIR: '/unused-in-tests', ZENITH_OPERATOR_ORIGIN: origin};
const doc = {'@id': 'urn:test:record', '@type': 'https://zenith-research.ca/ontology/terms/Artifact'};
function request(query = 'operation=session', headers = {}) {
  return new Request(origin + '/api/objects?' + query, {headers: {host: '127.0.0.1:4208', origin, 'content-type': 'application/json', ...headers}});
}
test('disabled operator and session reads cannot initialize persistence', async () => {
  const c = createObjectController({env: {}, storeFactory: () => assert.fail('initialized')});
  await assert.rejects(c.get(request()), {code: 'object_store_disabled'});
  const local = createObjectController({env, storeFactory: () => assert.fail('initialized')});
  assert.equal((await local.get(request())).mode, 'local');
});
test('host/origin/CSRF and closed action shapes guard all mutations', async t => {
  let opened = 0;
  const c = createObjectController({env, storeFactory: registry => {opened++; return new ObjectStore({memory: true, registry});}});
  t.after(() => c.close());
  const session = await c.get(request());
  const body = {schema: 'zenith.hub-object-action.v1', operation: 'import', document: doc, importKey: 'test'};
  for (const headers of [{host: 'attacker.invalid'}, {origin: 'https://attacker.invalid'}, {'x-zenith-csrf': 'bad'}, {'sec-fetch-site': 'cross-site'}])
    await assert.rejects(c.post(request('', headers), body));
  assert.equal(opened, 0);
  for (const extra of [{dataDir: '/browser/path'}, {registry: '/browser/schema'}, {operation: 'delete'}])
    await assert.rejects(c.post(request('', {'x-zenith-csrf': session.csrf}), {...body, ...extra}));
  const created = await c.post(request('', {'x-zenith-csrf': session.csrf}), body);
  assert.deepEqual(created.created, ['urn:test:record']);
  assert.equal(opened, 1);
  const read = await c.get(request('operation=get&id=urn%3Atest%3Arecord'));
  assert.equal(read.revision, 1);
  const exported = await c.get(request('operation=export'));
  assert.equal(exported.jsonld, true);
  assert.equal(exported.document[0]['@id'], 'urn:test:record');
});
test('create/update API binds identity and expected revisions', async t => {
  const c = createObjectController({env, storeFactory: registry => new ObjectStore({memory: true, registry})});
  t.after(() => c.close());
  const session = await c.get(request()), req = request('', {'x-zenith-csrf': session.csrf});
  const body = {schema: 'zenith.hub-object-action.v1', operation: 'create', id: 'urn:test:record', document: doc, importKey: 'one'};
  await c.post(req, body);
  await assert.rejects(c.post(req, {...body, operation: 'update', importKey: 'two'}));
  await assert.rejects(c.post(req, {...body, id: 'urn:wrong', importKey: 'three'}), {code: 'object_identity_mismatch'});
  const result = await c.post(req, {...body, operation: 'update', expectedRevision: 1, importKey: 'four', document: {...doc,
    'http://www.w3.org/2000/01/rdf-schema#label': 'Updated'}});
  assert.equal(result.revisions['urn:test:record'], 2);
});
