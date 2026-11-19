/** Owner-selected immutable resources. Imported documents never choose filesystem paths. */
import {readFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import jsonld from 'jsonld';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {OperatorError} from '../pilot-controller.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
export const absoluteIRI = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]*$/u.test(value);
export function reject(code, status = 422, details) {
  const error = new OperatorError(code, status);
  if (details !== undefined) error.details = details;
  throw error;
}
export function closed(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      required.some(k => !Object.hasOwn(value, k)) ||
      Object.keys(value).some(k => ![...required, ...optional].includes(k))) reject('invalid_request', 400);
}
async function pinnedFile(base, relative, expected, parse = /\.(json|jsonld)$/.test(relative)) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) reject('invalid_ontology_registry', 503);
  const file = path.join(base, relative);
  for (let current = file; current !== base; current = path.dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) reject('unsafe_ontology_resource', 503);
  }
  const info = await lstat(file);
  if (!info.isFile() || info.size > 5 * 1024 ** 2) reject('invalid_ontology_resource', 503);
  const bytes = await readFile(file);
  if (!/^[a-f0-9]{64}$/.test(expected || '') || sha256(bytes) !== expected) reject('ontology_resource_changed', 503);
  return {bytes, document: parse ? JSON.parse(new TextDecoder('utf8', {fatal: true}).decode(bytes)) : undefined};
}
export async function loadOntologyRegistry(file) {
  const config = JSON.parse(await readFile(file, 'utf8'));
  closed(config, ['schema', 'packages', 'resources', 'profiles']);
  if (config.schema !== 'zenith.hub-ontology-registry.v1' ||
      !['packages', 'resources', 'profiles'].every(k => Array.isArray(config[k]))) reject('invalid_ontology_registry', 503);
  const documents = {}, hashes = {}, schemas = new Map(), packages = [], ontologyDocuments = [];
  function register(url, document, hash) {
    if (!absoluteIRI(url) || Object.hasOwn(documents, url) && hashes[url] !== hash) reject('ontology_resource_collision', 503);
    documents[url] = document; hashes[url] = hash;
    if (document.$schema && document.$id) schemas.set(document.$id, document);
  }
  for (const entry of config.packages) {
    const base = path.resolve(path.dirname(file), entry.directory);
    if (path.isAbsolute(entry.directory) || entry.directory.split(/[\\/]/).includes('..') || (await lstat(base)).isSymbolicLink()) reject('invalid_ontology_registry', 503);
    const {document: manifest} = await pinnedFile(base, 'manifest.json', entry.manifestSha256);
    const assets = new Map();
    for (const row of manifest.files) assets.set(row.path, await pinnedFile(base, row.path, row.sha256));
    for (const [name, asset] of assets) {
      if (asset.document?.$id && asset.document?.$schema) register(asset.document.$id, asset.document, sha256(asset.bytes));
      if (name.endsWith('.jsonld')) {
        const declaration = manifest.ontologyDocuments.find(v => v.path === name);
        if (!declaration) continue; // Context-only assets are registered explicitly in resources.
        register(declaration.versionIri, asset.document, sha256(asset.bytes));
        register(declaration.ontologyId, asset.document, sha256(asset.bytes));
        ontologyDocuments.push({document: asset.document, package: manifest.ontologyId, version: manifest.version});
      }
    }
    packages.push({ontologyId: manifest.ontologyId, version: manifest.version,
      manifestSha256: entry.manifestSha256, bundleDigest: manifest.bundleDigest, source: entry.source});
  }
  for (const entry of config.resources) {
    const asset = await pinnedFile(path.dirname(file), entry.path, entry.sha256, true);
    register(entry.url, asset.document, entry.sha256);
  }
  const loader = async url => {
    if (!Object.hasOwn(documents, url)) reject('unsupported_context');
    return {contextUrl: null, documentUrl: url, document: structuredClone(documents[url])};
  };
  const types = new Map();
  for (const resource of ontologyDocuments) {
    const expanded = await jsonld.expand(resource.document, {documentLoader: loader, safe: true, base: null});
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value) && absoluteIRI(value['@id']) && Array.isArray(value['@type']) &&
          value['@type'].some(type => [OWL_CLASS, 'http://www.w3.org/2000/01/rdf-schema#Class'].includes(type))) {
        types.set(value['@id'], {package: resource.package, version: resource.version});
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(expanded);
  }
  const ajv = new Ajv2020({allErrors: true, strictSchema: true, strictTypes: false, allowUnionTypes: true, validateFormats: true});
  addFormats(ajv);
  for (const [id, document] of schemas) ajv.addSchema(document, id);
  const profiles = new Map();
  for (const item of config.profiles) {
    closed(item, ['id', 'representation', 'appliesTo'], ['identityField', 'typesField']);
    if (!['projection', 'expanded-node'].includes(item.representation) || !Array.isArray(item.appliesTo) ||
        !item.appliesTo.length || item.appliesTo.some(t => !types.has(t)) || profiles.has(item.id)) reject('invalid_schema_profile', 503);
    const [schemaId, fragment = ''] = item.id.split('#');
    let target = schemas.get(schemaId);
    if (!target) reject('unregistered_schema', 503);
    if (fragment) {
      if (!fragment.startsWith('/')) reject('invalid_schema_fragment', 503);
      for (const key of fragment.slice(1).split('/')) target = target?.[decodeURIComponent(key).replaceAll('~1', '/').replaceAll('~0', '~')];
    }
    if (!target || typeof target !== 'object' ||
        !['type', '$ref', 'properties', 'oneOf', 'anyOf', 'allOf'].some(k => Object.hasOwn(target, k))) reject('definition_only_schema', 503);
    let validate;
    try {validate = ajv.compile({$ref: item.id});} catch {reject('invalid_schema_profile', 503);}
    profiles.set(item.id, {...item, validate});
  }
  return {
    documents, hashes, types, profiles, packages,
    describe() {return {packages, types: [...types.keys()].sort(), profiles: [...profiles.values()].map(({validate, ...v}) => v)};},
    validateNode(node) {
      for (const p of profiles.values()) if (p.representation === 'expanded-node' && node['@type']?.some(t => p.appliesTo.includes(t))) {
        if (!p.validate(node)) reject('schema_validation_failed', 422, {profile: p.id, errors: p.validate.errors.map(e => ({path: e.instancePath, keyword: e.keyword}))});
      }
    },
    validateProjections(id, assertedTypes, bindings) {
      if (!Array.isArray(bindings)) reject('invalid_schema_binding');
      const seen = new Set();
      for (const binding of bindings) {
        closed(binding, ['profile', 'value']);
        const p = profiles.get(binding.profile);
        if (!p || p.representation !== 'projection' || seen.has(p.id)) reject('unregistered_schema_profile');
        seen.add(p.id);
        if (!assertedTypes.some(t => p.appliesTo.includes(t))) reject('schema_profile_type_mismatch');
        if (!p.validate(binding.value)) reject('schema_validation_failed', 422, {profile: p.id, errors: p.validate.errors.map(e => ({path: e.instancePath, keyword: e.keyword}))});
        if (p.identityField && binding.value[p.identityField] !== id) reject('schema_identity_mismatch');
        if (p.typesField && (!Array.isArray(binding.value[p.typesField]) || binding.value[p.typesField].length !== assertedTypes.length ||
            !binding.value[p.typesField].every(t => assertedTypes.includes(t)))) reject('schema_type_mismatch');
      }
    },
  };
}
