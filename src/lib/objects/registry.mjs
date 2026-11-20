/** Owner-selected immutable resources. Imported documents never choose filesystem paths. */
import {readFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import jsonld from 'jsonld';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {verifyModules} from './modules.mjs';
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
  const documents = {}, hashes = {}, schemas = new Map(), schemaHashes = new Map(), packages = [], ontologyDocuments = [], packageProfiles = [], policies = new Map(), relationshipRules = [], sizes = {};
  function register(url, document, hash) {
    if (!absoluteIRI(url) || Object.hasOwn(documents, url) && hashes[url] !== hash) reject('ontology_resource_collision', 503);
    documents[url] = document; hashes[url] = hash;
    if (document.$schema && document.$id) {
      if (!absoluteIRI(document.$id) || schemaHashes.has(document.$id) && schemaHashes.get(document.$id) !== hash) reject('schema_identity_collision', 503);
      schemas.set(document.$id, document); schemaHashes.set(document.$id, hash);
    }
  }
  for (const entry of config.packages) {
    const base = path.resolve(path.dirname(file), entry.directory);
    if (path.isAbsolute(entry.directory) || entry.directory.split(/[\\/]/).includes('..') || (await lstat(base)).isSymbolicLink()) reject('invalid_ontology_registry', 503);
    const {document: manifest} = await pinnedFile(base, 'manifest.json', entry.manifestSha256);
    if(!Array.isArray(manifest.ontologyDocuments)||!manifest.ontologyDocuments.some(d=>d.ontologyId===manifest.ontologyId&&d.versionIri===manifest.versionIri))reject('package_identity_mismatch',503);
    manifest.__manifestSha256 = entry.manifestSha256;
    const assets = new Map();
    for (const row of manifest.files) {if(assets.has(row.path))reject('duplicate_package_asset',503);assets.set(row.path, await pinnedFile(base,row.path,row.sha256,/\.(json|jsonld)$/.test(row.path)||manifest.ontologyDocuments.some(d=>d.path===row.path)));}
    if(manifest.ontologyDocuments.some(d=>!assets.has(d.path)))reject('missing_module_asset',503);
    for (const profile of manifest.profiles || []) packageProfiles.push(profile);
    for (const policy of manifest.admissionPolicies || []) {if (policies.has(policy.id)) reject('conflicting_admission_policy',503);policies.set(policy.id,policy);}
    relationshipRules.push(...(manifest.relationships || []));
    for (const [name, asset] of assets) {
      if (asset.document?.$id && asset.document?.$schema) register(asset.document.$id, asset.document, sha256(asset.bytes));
      if (manifest.ontologyDocuments.some(d=>d.path===name)) {
        const declaration = manifest.ontologyDocuments.find(v => v.path === name);
        if (!declaration) continue; // Context-only assets are registered explicitly in resources.
        register(declaration.versionIri, asset.document, sha256(asset.bytes));
        register(declaration.ontologyId, asset.document, sha256(asset.bytes));
        ontologyDocuments.push({document: asset.document, package: manifest.ontologyId, version: manifest.version, declaration, sha256:sha256(asset.bytes), manifest});
      }
    }
    for (const resource of manifest.resources || []) {
      const asset=assets.get(resource.path);
      if(!asset || sha256(asset.bytes)!==resource.sha256) reject('invalid_module_resource',503);
      register(resource.url,asset.document,resource.sha256);sizes[resource.url]=asset.bytes.length;
    }
    packages.push({ontologyId: manifest.ontologyId, version: manifest.version,
      manifestSha256: entry.manifestSha256, bundleDigest: manifest.bundleDigest, source: entry.source});
  }
  for (const entry of config.resources) {
    const asset = await pinnedFile(path.dirname(file), entry.path, entry.sha256, true);
    register(entry.url, asset.document, entry.sha256); sizes[entry.url]=asset.bytes.length;
  }
  const loader = async url => {
    if (!Object.hasOwn(documents, url)) reject('unsupported_context');
    return {contextUrl: null, documentUrl: url, document: structuredClone(documents[url])};
  };
  const moduleGraph=await verifyModules(ontologyDocuments,loader,jsonld);
  const {types,isSubclassOf}=moduleGraph;
  for(const rule of relationshipRules)if(!absoluteIRI(rule.predicate)||!Array.isArray(rule.subjects)||!Array.isArray(rule.targets)||[...rule.subjects,...rule.targets].some(t=>!types.has(t)))reject('invalid_relationship_rule',503);
  const ajv = new Ajv2020({allErrors: true, strictSchema: true, strictTypes: false, allowUnionTypes: true, validateFormats: true});
  addFormats(ajv);
  for (const [id, document] of schemas) ajv.addSchema(document, id);
  const schemaReferenceCheck = (value, base) => {
    if(!value || typeof value!=='object')return;
    if(typeof value.$ref==='string') {
      let resolved;try{resolved=new URL(value.$ref,base).href;}catch{reject('unresolved_schema_reference',503);}
      const [target,fragment='']=resolved.split('#');let definition=schemas.get(target);
      if(fragment){if(!fragment.startsWith('/'))reject('unsupported_schema_anchor',503);for(const key of fragment.slice(1).split('/'))definition=definition?.[decodeURIComponent(key).replaceAll('~1','/').replaceAll('~0','~')];}
      if(definition===undefined)reject('unresolved_schema_reference',503,{schema:base,reference:resolved});
    }
    for(const child of Object.values(value))schemaReferenceCheck(child,base);
  };
  for(const [id,schema]of schemas)schemaReferenceCheck(schema,id);
  const profiles = new Map();
  for (const item of [...config.profiles,...packageProfiles]) {
    closed(item, ['id', 'representation', 'appliesTo'], ['identityField', 'typesField','includeSubclasses','admissionOnly','distinctIdentityFields']);
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
  for(const policy of policies.values()) for(const requirement of policy.requiredProjections) if(!profiles.has(requirement.profile) || !types.has(requirement.type)) reject('invalid_admission_policy',503);
  return {
    documents, hashes, sizes, types, profiles, packages, policies, moduleGraph,
    validateDefinition(id,value) {let validate;try {validate=ajv.compile({$ref:id});}catch{reject('unregistered_schema_profile');}if(!validate(value))reject('schema_validation_failed',422,{profile:id});},
    matches(profile,assertedTypes) {return assertedTypes.some(t=>profile.appliesTo.some(parent=>t===parent || profile.includeSubclasses===true && isSubclassOf(t,parent)));},
    describe() {return {packages,verifiedModules:moduleGraph.describe(),subclassExpansion:'bounded-rdfs-subClassOf', types: [...types.keys()].sort(), profiles: [...profiles.values()].map(({validate, ...v}) => v)};},
    validateRelationships(quads, lookup) {
      for(const q of quads) {
        const rule=relationshipRules.find(r=>r.predicate===q.predicate.value);if(!rule)continue;
        if(q.object.termType!=='NamedNode') reject('infrastructure_relationship_requires_iri',422,{predicate:q.predicate.value});
        for(const [id,allowed]of [[q.subject.value,rule.subjects],[q.object.value,rule.targets]]) {
          const actual=lookup(id);if(actual.length && allowed.length && !actual.some(t=>allowed.some(parent=>isSubclassOf(t,parent)))) reject('relationship_type_mismatch',422,{id,predicate:q.predicate.value});
        }
      }
    },
    contractStatus(id, bindings) {
      const entity=bindings.find(b=>b.profile.endsWith('/core.schema.json#/$defs/EntityProjection'));
      if(!entity)return {content:'not-applicable',reachability:'not-tested',authorization:'not-tested'};
      const ref=entity.value.invocationContract;let content='unresolved';
      if(Object.hasOwn(documents,ref.id)) {
        if(hashes[ref.id]!==ref.sha256 || sizes[ref.id]!==ref.byteLength) reject('contract_reference_digest_mismatch',422,{id});
        const validator=profiles.get('https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json#/$defs/InvocationContract');
        if(!validator || !validator.validate(documents[ref.id])) reject('invalid_invocation_contract',422,{id});
        for(const operation of Object.values(documents[ref.id].operations)) for(const key of ['inputSchema','outputSchema','errorSchema']) {
          schemaReferenceCheck(operation[key],ref.id);
          try {ajv.compile(operation[key]);} catch {reject('invalid_operation_schema',422,{id,key});}
        }
        content='pinned-and-schema-validated';
      }
      return {content,reference:ref,reachability:'not-tested',authorization:'not-tested'};
    },
    validateNode(node, admission = 'observation') {
      for (const p of profiles.values()) if (p.representation === 'expanded-node' && (!p.admissionOnly || p.admissionOnly===admission) && this.matches(p,node['@type']||[])) {
        if (!p.validate(node)) reject('schema_validation_failed', 422, {profile: p.id, errors: p.validate.errors.map(e => ({path: e.instancePath, keyword: e.keyword}))});
      }
    },
    validateProjections(id, assertedTypes, bindings, admission = 'observation') {
      if (!Array.isArray(bindings)) reject('invalid_schema_binding');
      if(admission!=='observation') {
        const policy=policies.get(admission);if(!policy) reject('unknown_admission_policy');
        for(const requirement of policy.requiredProjections) if(assertedTypes.some(t=>isSubclassOf(t,requirement.type)) && !bindings.some(b=>b?.profile===requirement.profile)) reject('required_projection_missing',422,{id,profile:requirement.profile});
      }
      const seen = new Set();
      for (const binding of bindings) {
        closed(binding, ['profile', 'value']);
        const p = profiles.get(binding.profile);
        if (!p || p.representation !== 'projection' || seen.has(p.id)) reject('unregistered_schema_profile');
        seen.add(p.id);
        if (!this.matches(p,assertedTypes)) reject('schema_profile_type_mismatch');
        if (!p.validate(binding.value)) reject('schema_validation_failed', 422, {profile: p.id, errors: p.validate.errors.map(e => ({path: e.instancePath, keyword: e.keyword}))});
        if(p.distinctIdentityFields?.some(field=>binding.value[field]===id)) reject('binding_identity_conflation');
        if (p.identityField && binding.value[p.identityField] !== id) reject('schema_identity_mismatch');
        if (p.typesField && (!Array.isArray(binding.value[p.typesField]) || binding.value[p.typesField].length !== assertedTypes.length ||
            !binding.value[p.typesField].every(t => assertedTypes.includes(t)))) reject('schema_type_mismatch');
      }
    },
  };
}
