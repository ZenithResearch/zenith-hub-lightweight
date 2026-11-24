-- Foundation ledger: applied only to a new, explicitly opted-in private repository.
-- Existing user_version=2 objects/units/imports tables remain untouched during additive staging.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE hub_schema_migrations(version INTEGER PRIMARY KEY, ddl_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE hub_store_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), repository_id TEXT NOT NULL UNIQUE,
 generation INTEGER NOT NULL CHECK(generation>=0), writer_mode TEXT NOT NULL CHECK(writer_mode IN ('legacy','cutover','repository'))) STRICT;
CREATE TABLE hub_commits(id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, request_sha256 TEXT NOT NULL,
 generation INTEGER NOT NULL UNIQUE, result_json TEXT NOT NULL CHECK(json_valid(result_json)), committed_at TEXT NOT NULL) STRICT;
CREATE TABLE hub_files(sha256 TEXT PRIMARY KEY CHECK(length(sha256)=64), storage_key TEXT NOT NULL UNIQUE,
 byte_length INTEGER NOT NULL CHECK(byte_length>=0), media_type TEXT NOT NULL) STRICT;
CREATE TABLE hub_definition_sets(id TEXT PRIMARY KEY, manifest_sha256 TEXT NOT NULL REFERENCES hub_files(sha256)) STRICT;
CREATE TABLE hub_definition_pins(set_id TEXT NOT NULL REFERENCES hub_definition_sets(id), kind TEXT NOT NULL,
 iri TEXT NOT NULL, file_sha256 TEXT NOT NULL REFERENCES hub_files(sha256), PRIMARY KEY(set_id,kind,iri)) STRICT;
CREATE TABLE hub_object_identities(id TEXT PRIMARY KEY) STRICT;
CREATE TABLE hub_rdf_unit_versions(unit_id TEXT NOT NULL, unit_revision INTEGER NOT NULL CHECK(unit_revision>0),
 semantic_sha256 TEXT NOT NULL CHECK(length(semantic_sha256)=64), jsonld_sha256 TEXT NOT NULL REFERENCES hub_files(sha256),
 canonical_nquads TEXT NOT NULL, commit_id TEXT NOT NULL REFERENCES hub_commits(id), PRIMARY KEY(unit_id,unit_revision)) STRICT;
CREATE TABLE hub_rdf_unit_members(unit_id TEXT NOT NULL, unit_revision INTEGER NOT NULL, object_id TEXT NOT NULL REFERENCES hub_object_identities(id),
 PRIMARY KEY(unit_id,unit_revision,object_id), FOREIGN KEY(unit_id,unit_revision) REFERENCES hub_rdf_unit_versions(unit_id,unit_revision)) STRICT;
CREATE TABLE hub_object_versions(object_id TEXT NOT NULL REFERENCES hub_object_identities(id), object_revision INTEGER NOT NULL CHECK(object_revision>0),
 unit_id TEXT NOT NULL, unit_revision INTEGER NOT NULL, jsonld_sha256 TEXT NOT NULL REFERENCES hub_files(sha256),
 bindings_sha256 TEXT NOT NULL REFERENCES hub_files(sha256), definition_set_id TEXT NOT NULL REFERENCES hub_definition_sets(id),
 admission TEXT NOT NULL, legacy_read_only INTEGER NOT NULL DEFAULT 0 CHECK(legacy_read_only IN (0,1)), mapping_id TEXT, mapping_sha256 TEXT REFERENCES hub_files(sha256), commit_id TEXT NOT NULL REFERENCES hub_commits(id),
 PRIMARY KEY(object_id,object_revision), FOREIGN KEY(unit_id,unit_revision,object_id) REFERENCES hub_rdf_unit_members(unit_id,unit_revision,object_id),
 CHECK(admission='observation' OR legacy_read_only=1), CHECK((mapping_id IS NULL)=(mapping_sha256 IS NULL)), UNIQUE(object_id,object_revision,unit_id,unit_revision)) STRICT;
CREATE TABLE hub_current_units(unit_id TEXT PRIMARY KEY, unit_revision INTEGER NOT NULL,
 UNIQUE(unit_id,unit_revision), FOREIGN KEY(unit_id,unit_revision) REFERENCES hub_rdf_unit_versions(unit_id,unit_revision)) STRICT;
CREATE TABLE hub_current_objects(object_id TEXT PRIMARY KEY, object_revision INTEGER NOT NULL, unit_id TEXT NOT NULL, unit_revision INTEGER NOT NULL,
 UNIQUE(object_id,object_revision), FOREIGN KEY(object_id,object_revision,unit_id,unit_revision) REFERENCES hub_object_versions(object_id,object_revision,unit_id,unit_revision),
 FOREIGN KEY(unit_id,unit_revision) REFERENCES hub_current_units(unit_id,unit_revision) DEFERRABLE INITIALLY DEFERRED) STRICT;
CREATE TABLE hub_profile_values(object_id TEXT NOT NULL, object_revision INTEGER NOT NULL, profile_id TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), PRIMARY KEY(object_id,object_revision,profile_id),
 FOREIGN KEY(object_id,object_revision) REFERENCES hub_object_versions(object_id,object_revision)) STRICT;
CREATE TABLE hub_object_type_history(object_id TEXT NOT NULL, object_revision INTEGER NOT NULL, type_iri TEXT NOT NULL,
 PRIMARY KEY(object_id,object_revision,type_iri), FOREIGN KEY(object_id,object_revision) REFERENCES hub_object_versions(object_id,object_revision)) STRICT;
CREATE TABLE hub_rdf_links(unit_id TEXT NOT NULL, unit_revision INTEGER NOT NULL, subject TEXT NOT NULL, predicate TEXT NOT NULL, target TEXT NOT NULL, graph TEXT NOT NULL,
 PRIMARY KEY(unit_id,unit_revision,subject,predicate,target,graph), FOREIGN KEY(unit_id,unit_revision) REFERENCES hub_rdf_unit_versions(unit_id,unit_revision)) STRICT;
CREATE INDEX hub_link_source ON hub_rdf_links(subject,predicate);
CREATE INDEX hub_link_target ON hub_rdf_links(target,predicate);
CREATE INDEX hub_type_lookup ON hub_object_type_history(type_iri,object_id,object_revision);
CREATE TABLE hub_reference_bindings(owner_kind TEXT NOT NULL CHECK(owner_kind IN ('object','application')), owner_id TEXT NOT NULL,
 owner_revision INTEGER NOT NULL CHECK(owner_revision>0), field TEXT NOT NULL CHECK(substr(field,1,1)='/'), target_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('current','object-version','external')), target_revision INTEGER,
 PRIMARY KEY(owner_kind,owner_id,owner_revision,field,target_id),
 FOREIGN KEY(target_id,target_revision) REFERENCES hub_object_versions(object_id,object_revision),
 CHECK((mode='object-version' AND target_revision>0) OR (mode!='object-version' AND target_revision IS NULL))) STRICT;
CREATE INDEX hub_reference_target ON hub_reference_bindings(target_id,target_revision);
CREATE TABLE hub_identity_aliases(namespace TEXT NOT NULL, alias_key TEXT NOT NULL, target_id TEXT NOT NULL REFERENCES hub_object_identities(id),
 provenance_sha256 TEXT NOT NULL REFERENCES hub_files(sha256), PRIMARY KEY(namespace,alias_key)) STRICT;
CREATE TABLE hub_legacy_imports(source_namespace TEXT NOT NULL, source_key TEXT NOT NULL, source_sha256 TEXT NOT NULL REFERENCES hub_files(sha256),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)), commit_id TEXT NOT NULL REFERENCES hub_commits(id), PRIMARY KEY(source_namespace,source_key,source_sha256)) STRICT;
PRAGMA user_version=3;
COMMIT;
