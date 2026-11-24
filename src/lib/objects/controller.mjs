import {operatorCsrf} from '../operator-session.mjs';
/** One local operator API; request documents cannot configure storage or loaders. */
import {exportBundle,importBundle} from './bundle.mjs';
import path from 'node:path';
import {openObjectStore} from './open-store.mjs';
import {loadOntologyRegistry, closed, reject} from './registry.mjs';
export function createObjectController({env = process.env, registryFile = path.join(process.cwd(), 'profiles/object-store/registry.json'), storeFactory} = {}) {
  const enabled = env.ZENITH_LOCAL_OPERATOR === '1' && !!env.ZENITH_HUB_DATA_DIR;
  const origin = env.ZENITH_OPERATOR_ORIGIN || 'http://127.0.0.1:4208';
  const expected = new URL(origin), csrf = operatorCsrf('objects',env);
  if (expected.origin !== origin || expected.hostname !== '127.0.0.1' || expected.protocol !== 'http:' || !expected.port) reject('invalid_operator_origin', 503);
  let storePromise;
  function admit(request, mutation = false) {
    if (!enabled) reject('object_store_disabled', 403);
    const site = request.headers.get('sec-fetch-site'), supplied = request.headers.get('origin');
    if (new URL(request.url).origin !== origin || request.headers.get('host') !== expected.host ||
        supplied && supplied !== origin || site && !['same-origin', 'none'].includes(site)) reject('wrong_origin', 403);
    if (mutation && (supplied !== origin || request.headers.get('x-zenith-csrf') !== csrf ||
        request.headers.get('content-type') !== 'application/json')) reject('cross_site_action', 403);
  }
  async function store() {
    if (!storePromise) storePromise = (async () => {
      const registry = await loadOntologyRegistry(env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE || registryFile);
      return storeFactory ? storeFactory(registry) : await openObjectStore({env,registry,registryFile:env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE||registryFile});
    })().catch(error => {storePromise = null; throw error;});
    return storePromise;
  }
  return {
    admitMutation(request) {admit(request, true);},
    async get(request) {
      admit(request);
      const parameters = new URL(request.url).searchParams;
      const query = Object.fromEntries(parameters);
      const operation = query.operation || 'list';
      for (const key of parameters.keys()) if (parameters.getAll(key).length > 1 && !(['export','export-bundle'].includes(operation) && key === 'id')) reject('duplicate_query_parameter', 400);
      if (operation === 'session') {
        closed(query, ['operation']);
        return {schema: 'zenith.hub-object-session.v1', csrf, mode: 'local'};
      }
      const s = await store();
      if (operation === 'registry') {closed(query, ['operation']); return s.registry.describe();}
      if (operation === 'list') {
        closed(query, [], ['operation', 'type', 'after', 'limit','includeSubclasses']);
        if(query.includeSubclasses!==undefined&&!['true','false'].includes(query.includeSubclasses))reject('invalid_list_query',400);
        return {schema: 'zenith.hub-object-list.v1', ...s.list({...query,includeSubclasses:query.includeSubclasses==='true', limit: query.limit === undefined ? 100 : Number(query.limit)})};
      }
      if (operation === 'get') {closed(query, ['operation', 'id'],['revision']);if(query.revision!==undefined){const revision=Number(query.revision);if(!Number.isSafeInteger(revision)||revision<1)reject('invalid_object_revision',400);if(!s.getVersion)reject('historical_revision_unavailable',404);return {schema:'zenith.hub-object.v1',...await s.getVersion(query.id,revision)};}return {schema:'zenith.hub-object.v1',...await s.get(query.id)};}
      if (operation === 'relationships') {
        closed(query, ['operation', 'id'], ['direction', 'predicate', 'limit']);
        return {schema: 'zenith.hub-object-relationships.v1', ...await s.relationships({...query, limit: query.limit === undefined ? 1000 : Number(query.limit)})};
      }
      if (operation === 'connected') {
        closed(query, ['operation', 'id'], ['depth', 'limit']);
        const connected = await s.connected({...query, depth: query.depth === undefined ? 1 : Number(query.depth), limit: query.limit === undefined ? 100 : Number(query.limit)});
        return {schema: 'zenith.hub-object-set.v1', ...connected, document: await s.exportDocument({ids: connected.ids})};
      }
      if (['export','export-bundle'].includes(operation)) {
        closed(query, ['operation'], ['id', 'graph']);
        if (query.id && query.graph) reject('ambiguous_export_selection', 400);
        const selection=query.id ? {ids:parameters.getAll('id')} : query.graph ? {graph:query.graph} : {};
        return operation==='export-bundle' ? {bundle:true,document:await exportBundle(s,selection)} : {jsonld:true,document:await s.exportDocument(selection)};
      }
      reject('invalid_object_operation', 400);
    },
    async post(request, body) {
      admit(request, true);
      closed(body, ['schema', 'operation', 'document', 'importKey'], ['expectedRevisions', 'source', 'projections', 'id', 'expectedRevision','admission','expectedBundleSha256','referenceBindings']);
      if (body.schema !== 'zenith.hub-object-action.v1' || !['create', 'update', 'import','import-bundle'].includes(body.operation)) reject('invalid_object_operation', 400);
      if(body.operation==='import-bundle') {
        if(['id','expectedRevision','admission','projections'].some(k=>Object.hasOwn(body,k)))reject('invalid_request',400);
        return importBundle(await store(),body.document,{importKey:body.importKey,expectedBundleSha256:body.expectedBundleSha256,expectedRevisions:body.expectedRevisions??{},source:body.source??null,...(body.referenceBindings!==undefined?{referenceBindings:body.referenceBindings}:{})});
      }
      if(Object.hasOwn(body,'expectedBundleSha256'))reject('invalid_request',400);
      if (body.operation === 'import' && (body.id !== undefined || body.expectedRevision !== undefined) ||
          body.operation !== 'import' && body.expectedRevisions !== undefined ||
          body.operation === 'create' && body.expectedRevision !== undefined) reject('invalid_request', 400);
      const s = await store();
      return s.importDocument(body.document, {importKey: body.importKey, intent: body.operation,
        ...(body.operation === 'import' ? {expectedRevisions: body.expectedRevisions ?? {}} : {objectId: body.id,
          expectedRevisions: body.operation === 'update' ? {[body.id]: body.expectedRevision} : {}}),
        ...(body.admission!==undefined?{admission:body.admission}:{}),
        source: body.source ?? null, projections: body.projections ?? {},...(body.referenceBindings!==undefined?{referenceBindings:body.referenceBindings}:{})});
    },
    async close() {if(storePromise){const s=await storePromise;if(!s.applicationOwned)await s.close();}},
  };
}
