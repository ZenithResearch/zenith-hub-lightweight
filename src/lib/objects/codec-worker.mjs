/** All JSON-LD interpretation and potentially expensive canonicalization stays off the Hub event loop. */
import {parentPort, workerData} from 'node:worker_threads';
import jsonld from 'jsonld';
import rdf from 'rdf-canonize';
const {NQuads} = rdf;
const fail = code => {throw Object.assign(new Error(code), {code});};
const options = {safe: true, base: null, documentLoader: async url => {
  if (!Object.hasOwn(workerData.documents, url)) fail('unsupported_context');
  used.add(url);
  return {contextUrl: null, documentUrl: url, document: structuredClone(workerData.documents[url])};
}};
const used = new Set();
const canon = quads => rdf.canonize(quads, {algorithm: 'RDFC-1.0', maxWorkFactor: 1});
async function fromRDF(nquads) {
  const input = NQuads.parse(nquads);
  const output = await jsonld.fromRDF(nquads, {format: 'application/n-quads', useNativeTypes: false});
  // jsonld 9.0.0 prefixes blank subjects/objects but not blank graph names in fromRDF.
  // Repair only those known graph identifiers, then verify the complete RDF dataset.
  const blankGraphs = new Set(input.filter(q => q.graph.termType === 'BlankNode').map(q => q.graph.value));
  for (const node of output) if (node['@graph'] && blankGraphs.has(node['@id'])) node['@id'] = '_:' + node['@id'];
  const restored = await jsonld.toRDF(output, options);
  if (await canon(input) !== await canon(restored)) fail('non_lossless_jsonld_export');
  return output;
}
function checkExpanded(value, depth = 0) {
  if (depth > 64) fail('document_too_deep');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {for (const child of value) checkExpanded(child, depth + 1); return;}
  for (const key of ['@direction', '@index']) if (Object.hasOwn(value, key)) fail('unsupported_jsonld_feature');
  if (value['@type'] === '@json') fail('unsupported_jsonld_feature');
  if (Object.hasOwn(value, '@graph') && value['@graph'].length === 0) fail('empty_named_graph_unsupported');
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('_:')) fail('generalized_rdf_unsupported');
    checkExpanded(child, depth + 1);
  }
}
function checkJSON(value, depth = 0) {
  if (depth > 64) fail('document_too_deep');
  if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) fail('unsafe_json_number');
  if (value && typeof value === 'object') for (const child of Object.values(value)) checkJSON(child, depth + 1);
}
async function interpret() {
  checkJSON(workerData.document);
  const expanded = await jsonld.expand(workerData.document, options);
  checkExpanded(expanded);
  const quads = await jsonld.toRDF(expanded, options);
  if (quads.length > 10000) fail('dataset_too_large');
  for (const q of quads) for (const term of [q.subject, q.predicate, q.object, q.graph]) {
    if (term.termType === 'NamedNode' && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(term.value)) fail('relative_iri_unsupported');
  }
  // Union all assertions of a named subject and every assertion sharing a blank node.
  // Consequently a shared anonymous structure is one indivisible replacement unit.
  const parents = quads.map((_, i) => i), terms = new Map();
  const find = i => parents[i] === i ? i : (parents[i] = find(parents[i]));
  const join = (a, b) => {parents[find(a)] = find(b);};
  for (let i = 0; i < quads.length; ++i) {
    const q = quads[i];
    const keys = [q.subject.termType + ':' + q.subject.value,
      ...[q.subject, q.object, q.graph].filter(t => t.termType === 'BlankNode').map(t => 'BlankNode:' + t.value)];
    for (const key of keys) {if (terms.has(key)) join(i, terms.get(key)); else terms.set(key, i);}
  }
  const groups = new Map();
  quads.forEach((q, i) => {const key = find(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(q);});
  const fragments = [];
  for (const group of groups.values()) {
    const ids = [...new Set(group.filter(q => q.subject.termType === 'NamedNode').map(q => q.subject.value))].sort();
    const nquads = await canon(group);
    fragments.push({ids, nquads, nodes: await fromRDF(nquads)});
  }
  if (fragments.reduce((n, f) => n + f.ids.length, 0) > 1000) fail('dataset_too_large');
  return {nquads: await canon(quads), fragments, contexts: [...used].sort()};
}
try {
  let result;
  if (workerData.operation === 'interpret') result = await interpret();
  else if (workerData.operation === 'export') result = await fromRDF(workerData.nquads);
  else if (workerData.operation === 'canonicalize') result = await canon(NQuads.parse(workerData.nquads));
  else fail('invalid_codec_operation');
  parentPort.postMessage({ok: true, result});
} catch (error) {
  parentPort.postMessage({ok: false, code: error.code === 'unsupported_context' || error.message === 'unsupported_context'
    ? 'unsupported_context' : error.details?.cause?.code === 'unsupported_context' ? 'unsupported_context'
    : ['unsupported_jsonld_feature', 'empty_named_graph_unsupported', 'generalized_rdf_unsupported', 'relative_iri_unsupported',
       'dataset_too_large', 'empty_dataset', 'document_too_deep', 'non_lossless_jsonld_export', 'unsafe_json_number'].includes(error.code) ? error.code : 'invalid_jsonld'});
}
