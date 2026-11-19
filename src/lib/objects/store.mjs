/** Hub-owned SQLite assertions plus separate concurrency/provenance metadata. */
import {DatabaseSync} from 'node:sqlite';
import {constants, openSync, closeSync, mkdirSync, lstatSync, existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import rdf from 'rdf-canonize';
import {processDataset} from './codec.mjs';
import {absoluteIRI, closed, reject, RDF_TYPE, sha256} from './registry.mjs';
const APPLICATION_ID = 0x5a484f42;
const {NQuads} = rdf;
const sortedJSON = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(sortedJSON(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(sortedJSON(value[k]))])) : value);
const members = quads => [...new Set(quads.filter(q => q.subject.termType === 'NamedNode').map(q => q.subject.value))].sort();
const assertedTypes = (quads, id) => [...new Set(quads.filter(q => q.subject.value === id &&
  q.predicate.value === RDF_TYPE && q.object.termType === 'NamedNode').map(q => q.object.value))].sort();
const scopedTerm = (term, unit) => term.termType === 'BlankNode' ? {...term, value: 'u' + unit.replaceAll('-', '') + '_' + term.value} : term;
function scopedQuads(unit) {
  return NQuads.parse(unit.nquads).map(q => Object.fromEntries(Object.entries(q).map(([k, t]) => [k, scopedTerm(t, unit.id)])));
}
function privateDatabase(dataDir) {
  if (!path.isAbsolute(dataDir)) reject('invalid_hub_data_directory', 503);
  for (let current = dataDir; ; current = path.dirname(current)) {
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || ![0, process.getuid()].includes(stat.uid) ||
          (stat.mode & 0o022) && !(stat.uid === 0 && stat.mode & 0o1000)) reject('unsafe_hub_data_directory', 503);
    }
    if (current === path.dirname(current)) break;
  }
  mkdirSync(dataDir, {recursive: true, mode: 0o700});
  const directory = lstatSync(dataDir);
  if (directory.uid !== process.getuid() || directory.mode & 0o077) reject('unsafe_hub_data_directory', 503);
  const file = path.join(dataDir, 'objects.sqlite');
  if (!existsSync(file)) closeSync(openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) {
    const stat = lstatSync(file + suffix);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.nlink !== 1 || stat.mode & 0o077) reject('unsafe_hub_database', 503);
  }
  return file;
}
export class ObjectStore {
  constructor({dataDir, registry, memory = false}) {
    this.registry = registry;
    this.db = new DatabaseSync(memory ? ':memory:' : privateDatabase(dataDir), {timeout: 2000, allowExtension: false});
    try {
      const application = this.db.prepare('PRAGMA application_id').get().application_id;
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
      if ((application !== APPLICATION_ID && (application !== 0 || tables.length)) || version > 1) reject('not_a_supported_hub_database', 503);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY, nquads TEXT NOT NULL, semantic_sha256 TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id),
          revision INTEGER NOT NULL CHECK(revision>0), updated_at TEXT NOT NULL, last_import TEXT NOT NULL, profiles TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS object_types(object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
          type TEXT NOT NULL, PRIMARY KEY(object_id,type));
        CREATE TABLE IF NOT EXISTS object_links(unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
          subject TEXT NOT NULL, predicate TEXT NOT NULL, target TEXT NOT NULL, graph TEXT NOT NULL,
          PRIMARY KEY(unit_id,subject,predicate,target,graph));
        CREATE TABLE IF NOT EXISTS imports(import_key TEXT PRIMARY KEY, request_digest TEXT NOT NULL,
          content_sha256 TEXT NOT NULL, semantic_sha256 TEXT NOT NULL, provenance TEXT NOT NULL, result TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS object_type_lookup ON object_types(type,object_id);
        CREATE INDEX IF NOT EXISTS object_link_source ON object_links(subject,predicate);
        CREATE INDEX IF NOT EXISTS object_link_target ON object_links(target,predicate);
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; COMMIT;`);
    } catch (error) {this.db.close(); throw error;}
  }
  close() {this.db.close();}
  row(id) {return this.db.prepare('SELECT * FROM objects WHERE id=?').get(id);}
  unit(id) {return this.db.prepare('SELECT * FROM units WHERE id=?').get(id);}
  index(unit) {
    const quads = scopedQuads(unit);
    for (const id of members(quads)) for (const type of assertedTypes(quads, id)) {
      this.db.prepare('INSERT OR IGNORE INTO object_types VALUES(?,?)').run(id, type);
    }
    for (const q of quads) if (q.object.termType !== 'Literal') {
      const spelling = t => t.termType === 'BlankNode' ? '_:' + t.value : t.value;
      this.db.prepare('INSERT OR IGNORE INTO object_links VALUES(?,?,?,?,?)').run(unit.id,
        spelling(q.subject), q.predicate.value, spelling(q.object), spelling(q.graph));
    }
  }
  rebuildIndexes() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM object_types; DELETE FROM object_links;');
      for (const unit of this.db.prepare('SELECT * FROM units').all()) {
        const ids = members(NQuads.parse(unit.nquads));
        const owned = this.db.prepare('SELECT id FROM objects WHERE unit_id=? ORDER BY id').all(unit.id).map(r => r.id);
        if (JSON.stringify(ids) !== JSON.stringify(owned)) reject('object_metadata_inconsistent', 503);
        this.index(unit);
      }
      this.db.exec('COMMIT');
      return {rebuilt: true};
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  async importDocument(document, options = {}) {
    closed(options, ['importKey'], ['expectedRevisions', 'source', 'projections', 'intent', 'objectId']);
    const {importKey, source = null, expectedRevisions = {}, projections = {}, intent = 'import', objectId} = options;
    if (typeof importKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(importKey) ||
        source !== null && (typeof source !== 'string' || source.length > 512) ||
        !['import', 'create', 'update'].includes(intent) ||
        !expectedRevisions || Array.isArray(expectedRevisions) || typeof expectedRevisions !== 'object' ||
        !projections || Array.isArray(projections) || typeof projections !== 'object') reject('invalid_import_options', 400);
    for (const [id, version] of Object.entries(expectedRevisions)) {
      if (!absoluteIRI(id) || !Number.isSafeInteger(version) || version < 0) reject('invalid_expected_revision', 400);
    }
    const inputWasString = typeof document === 'string';
    let content;
    if (typeof document === 'string') {
      content = document;
      try {document = JSON.parse(document);} catch {reject('invalid_json', 400);}
    } else content = JSON.stringify(document);
    if (!content || Buffer.byteLength(content) > 1024 ** 2) reject('request_too_large', 413);
    if (!document || typeof document !== 'object') reject('invalid_jsonld');
    const interpreted = await processDataset('interpret', {document}, this.registry);
    const fragments = interpreted.fragments.map(f => ({...f, quads: NQuads.parse(f.nquads)}));
    const ids = fragments.flatMap(f => f.ids);
    if (new Set(ids).size !== ids.length) reject('invalid_subject_partition');
    if (intent !== 'import' && (!absoluteIRI(objectId) || ids.length !== 1 || ids[0] !== objectId)) reject('object_identity_mismatch');
    if (intent === 'update' && !Object.hasOwn(expectedRevisions, objectId)) reject('expected_revision_required', 409);
    for (const id of [...Object.keys(expectedRevisions), ...Object.keys(projections)]) if (!ids.includes(id)) reject('unknown_import_object', 400);
    const validatedProfiles = new Set();
    for (const f of fragments) {
      for (const q of f.quads) if (q.predicate.value === RDF_TYPE &&
          (q.object.termType !== 'NamedNode' || !this.registry.types.has(q.object.value))) reject('unrecognized_ontology_type', 422, {type: q.object.value});
      // Validate expanded-node profiles on the actual JSON-LD representation, not a $defs-only schema root.
      const nodes = f.nodes;
      const visit = list => {for (const node of list) {
        this.registry.validateNode(node);
        for (const profile of this.registry.profiles.values()) if (profile.representation === 'expanded-node' && node['@type']?.some(t => profile.appliesTo.includes(t))) validatedProfiles.add(profile.id);
        if (node['@graph']) visit(node['@graph']);
      }};
      visit(nodes);
    }
    const semanticSha256 = sha256(interpreted.nquads), contentSha256 = sha256(content);
    const requestDigest = sha256(semanticSha256 + sortedJSON({source, expectedRevisions, projections, intent, objectId: objectId || null}));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT * FROM imports WHERE import_key=?').get(importKey);
      if (previous) {
        if (previous.request_digest !== requestDigest) reject('import_key_conflict', 409);
        this.db.exec('COMMIT');
        return {...JSON.parse(previous.result), replayed: true};
      }
      const existing = new Map(ids.map(id => [id, this.row(id)]));
      for (const [id, expected] of Object.entries(expectedRevisions)) if ((existing.get(id)?.revision || 0) !== expected) reject('stale_revision', 409, {id, expected, actual: existing.get(id)?.revision || 0});
      if (intent === 'create' && existing.get(objectId)) reject('object_already_exists', 409);
      if (intent === 'update' && !existing.get(objectId)) reject('object_not_found', 404);
      const changed = [], unchanged = [], replaced = new Set(), metadataChanged = new Set(), bindings = new Map();
      for (const f of fragments) {
        for (const id of f.ids) {
          const old = existing.get(id);
          const value = Object.hasOwn(projections, id) ? projections[id] : JSON.parse(old?.profiles || '[]');
          this.registry.validateProjections(id, assertedTypes(f.quads, id), value);
          bindings.set(id, value);
          for (const binding of value) validatedProfiles.add(binding.profile);
          if (old && sortedJSON(value) !== sortedJSON(JSON.parse(old.profiles))) metadataChanged.add(id);
        }
        const owners = new Set(f.ids.map(id => existing.get(id)?.unit_id).filter(Boolean));
        const old = owners.size === 1 ? this.unit([...owners][0]) : null;
        if (f.ids.length && old?.nquads === f.nquads) unchanged.push(f);
        else {
          changed.push(f);
          for (const owner of owners) replaced.add(owner);
        }
      }
      const changedIDs = new Set([...changed.flatMap(f => f.ids), ...metadataChanged]);
      for (const owner of replaced) {
        for (const {id} of this.db.prepare('SELECT id FROM objects WHERE unit_id=?').all(owner)) {
          if (!ids.includes(id)) reject('connected_update_requires_complete_unit', 409, {missing: id});
        }
      }
      for (const id of changedIDs) if (existing.get(id) && !Object.hasOwn(expectedRevisions, id)) reject('expected_revision_required', 409, {id});
      const now = new Date().toISOString();
      const provenance = {source, importedAt: now, contexts: interpreted.contexts.map(url => ({url, sha256: this.registry.hashes[url]})),
        packages: this.registry.packages, contentHashBasis: inputWasString ? 'input-json-string' : 'JSON.stringify(document)'};
      const result = {schema: 'zenith.hub-object-import-result.v1', importKey, replayed: false,
        created: ids.filter(id => !existing.get(id)).sort(), updated: [...changedIDs].filter(id => existing.get(id)).sort(),
        alreadyPresent: ids.filter(id => !changedIDs.has(id)).sort(),
        anonymousUnitsCreated: changed.filter(f => !f.ids.length).length, revisions: {},
        contentSha256, semanticSha256, semanticAlgorithm: 'RDFC-1.0', validation: {jsonld: 'interpreted',
          schemaProfiles: [...validatedProfiles].sort(),
          owlReasoning: false, invocationConformance: 'not-assessed'}};
      this.db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?)').run(importKey, requestDigest, contentSha256,
        semanticSha256, JSON.stringify(provenance), '{}');
      for (const owner of replaced) {
        this.db.prepare('DELETE FROM objects WHERE unit_id=?').run(owner);
        this.db.prepare('DELETE FROM units WHERE id=?').run(owner);
      }
      for (const f of changed) {
        const unit = {id: randomUUID(), nquads: f.nquads};
        this.db.prepare('INSERT INTO units VALUES(?,?,?)').run(unit.id, unit.nquads, sha256(unit.nquads));
        for (const id of f.ids) this.db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?)').run(id, unit.id,
          (existing.get(id)?.revision || 0) + 1, now, importKey, JSON.stringify(bindings.get(id)));
        this.index(unit);
      }
      for (const f of unchanged) for (const id of f.ids) if (metadataChanged.has(id)) {
        this.db.prepare('UPDATE objects SET revision=revision+1, updated_at=?, last_import=?, profiles=? WHERE id=?')
          .run(now, importKey, JSON.stringify(bindings.get(id)), id);
      }
      for (const id of ids) result.revisions[id] = this.row(id).revision;
      this.db.prepare('UPDATE imports SET result=? WHERE import_key=?').run(JSON.stringify(result), importKey);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  list({type, after = '', limit = 100} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || typeof after !== 'string' || type !== undefined && !absoluteIRI(type)) reject('invalid_list_query', 400);
    const rows = type ? this.db.prepare('SELECT o.id,o.revision FROM objects o JOIN object_types t ON t.object_id=o.id WHERE t.type=? AND o.id>? ORDER BY o.id LIMIT ?').all(type, after, limit + 1)
      : this.db.prepare('SELECT id,revision FROM objects WHERE id>? ORDER BY id LIMIT ?').all(after, limit + 1);
    return {items: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null};
  }
  relationships({id, direction = 'outgoing', predicate, limit = 1000} = {}) {
    if (!absoluteIRI(id) || !['incoming', 'outgoing'].includes(direction) || predicate !== undefined && !absoluteIRI(predicate) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) reject('invalid_relationship_query', 400);
    const column = direction === 'incoming' ? 'target' : 'subject';
    const rows = predicate ? this.db.prepare(`SELECT subject,predicate,target,graph FROM object_links WHERE ${column}=? AND predicate=? ORDER BY graph,predicate,subject,target LIMIT ?`).all(id, predicate, limit + 1)
      : this.db.prepare(`SELECT subject,predicate,target,graph FROM object_links WHERE ${column}=? ORDER BY graph,predicate,subject,target LIMIT ?`).all(id, limit + 1);
    return {items: rows.slice(0, limit), truncated: rows.length > limit};
  }
  connected({id, depth = 1, limit = 100} = {}) {
    if (!absoluteIRI(id) || !Number.isSafeInteger(depth) || depth < 0 || depth > 8 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) reject('invalid_connected_query', 400);
    if (!this.row(id)) reject('object_not_found', 404);
    const peers = unit => this.db.prepare('SELECT id FROM objects WHERE unit_id=? ORDER BY id').all(unit).map(r => r.id);
    const initial = peers(this.row(id).unit_id);
    if (initial.length > limit) reject('connected_limit_below_atomic_unit', 400);
    const found = new Set(initial), external = new Set(); let frontier = initial, truncated = false;
    for (let step = 0; step < depth && frontier.length; step++) {
      const next = [], units = new Set(frontier.map(object => this.row(object).unit_id));
      function include(candidate) {
        for (const object of candidate) if (!found.has(object)) {found.add(object); next.push(object);}
      }
      const addUnit = unit => {
        const candidate = peers(unit), missing = candidate.filter(object => !found.has(object));
        if (found.size + missing.length > limit) truncated = true;
        else include(candidate);
      };
      for (const unit of units) {
        // Anonymous structural nodes are followed inside their atomic unit.
        const links = this.db.prepare('SELECT * FROM object_links WHERE unit_id=? ORDER BY subject,predicate,target LIMIT 10001').all(unit);
        for (const link of links) {
          if (link.target.startsWith('_:') || link.predicate === RDF_TYPE || link.target === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil') continue;
          const target = this.row(link.target);
          if (!target) external.add(link.target); else addUnit(target.unit_id);
        }
        for (const object of peers(unit)) {
          const incoming = this.db.prepare('SELECT * FROM object_links WHERE target=? LIMIT 1001').all(object);
          truncated ||= incoming.length > 1000;
          for (const link of incoming.slice(0, 1000)) if (link.predicate !== RDF_TYPE) addUnit(link.unit_id);
        }
      }
      frontier = next;
    }
    return {ids: [...found].sort(), externalReferences: [...external].sort(), truncated};
  }
  async exportDocument(selection = {}) {
    closed(selection, [], ['ids', 'graph']);
    const {ids, graph} = selection;
    if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !absoluteIRI(id))) ||
        graph !== undefined && graph !== '@default' && !absoluteIRI(graph) && !/^_:u[a-zA-Z0-9_]+$/.test(graph) || ids && graph !== undefined) reject('invalid_export_selection', 400);
    let units;
    if (ids) {
      const unitIDs = new Set(ids.map(id => {
        const row = this.row(id); if (!row) reject('object_not_found', 404); return row.unit_id;
      }));
      units = [...unitIDs].map(id => this.unit(id));
    } else units = this.db.prepare('SELECT * FROM units ORDER BY id').all();
    let quads = units.flatMap(scopedQuads);
    if (graph !== undefined) quads = quads.filter(q => graph === '@default' ? q.graph.termType === 'DefaultGraph' :
      graph.startsWith('_:') ? q.graph.termType === 'BlankNode' && '_:' + q.graph.value === graph : q.graph.termType === 'NamedNode' && q.graph.value === graph);
    if (quads.length > 10000) reject('export_too_large', 413);
    return processDataset('export', {nquads: NQuads.serialize(quads)});
  }

  async get(id) {
    if (!absoluteIRI(id)) reject('invalid_object_id', 400);
    const record = this.row(id);
    if (!record) reject('object_not_found', 404);
    const types = this.db.prepare('SELECT type FROM object_types WHERE object_id=? ORDER BY type').all(id).map(r => r.type);
    const peers = this.db.prepare('SELECT id,revision FROM objects WHERE unit_id=? ORDER BY id').all(record.unit_id);
    const provenance = JSON.parse(this.db.prepare('SELECT provenance FROM imports WHERE import_key=?').get(record.last_import).provenance);
    return {id, revision: record.revision, types, atomicUnit: peers, updatedAt: record.updated_at,
      projections: JSON.parse(record.profiles), provenance,
      validation: {typeRecognition: types.length ? 'asserted-types' : 'untyped-description', types: types.map(type => ({type, recognized: this.registry.types.has(type), ...this.registry.types.get(type)})), invocationConformance: 'not-assessed'},
      document: await this.exportDocument({ids: [id]})};
  }
}
