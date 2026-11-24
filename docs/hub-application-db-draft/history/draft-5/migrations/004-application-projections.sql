-- DESIGN ONLY. Execute only after repository cutover backfill has been independently validated.
BEGIN IMMEDIATE;
CREATE TABLE hub_record_heads(kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(kind,id)) STRICT;
CREATE TABLE hub_projections(kind TEXT NOT NULL, object_id TEXT NOT NULL, object_revision INTEGER NOT NULL, profile_id TEXT NOT NULL,
 projected_json TEXT NOT NULL CHECK(json_valid(projected_json)), PRIMARY KEY(kind,object_id),
 FOREIGN KEY(kind,object_id) REFERENCES hub_record_heads(kind,id), FOREIGN KEY(object_id,object_revision) REFERENCES hub_current_objects(object_id,object_revision),
 FOREIGN KEY(object_id,object_revision,profile_id) REFERENCES hub_profile_values(object_id,object_revision,profile_id)) STRICT;
CREATE TABLE hub_software_keys(software_key TEXT PRIMARY KEY, object_id TEXT NOT NULL UNIQUE REFERENCES hub_object_identities(id)) STRICT;
CREATE TABLE hub_settings(id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'HubSettings' CHECK(kind='HubSettings'), label TEXT NOT NULL,
 local_host_id TEXT REFERENCES hub_current_objects(object_id), selected_guide_profile_id TEXT REFERENCES hub_current_objects(object_id), entered_at TEXT,
 FOREIGN KEY(kind,id) REFERENCES hub_record_heads(kind,id)) STRICT;
CREATE TABLE hub_catalog_entries(id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'SoftwareCatalogEntry' CHECK(kind='SoftwareCatalogEntry'),
 catalog_id TEXT NOT NULL, catalog_key TEXT NOT NULL, software_id TEXT NOT NULL REFERENCES hub_current_objects(object_id), adapter_ref TEXT NOT NULL,
 supported_modes_json TEXT NOT NULL CHECK(json_valid(supported_modes_json)), UNIQUE(catalog_id,catalog_key), FOREIGN KEY(kind,id) REFERENCES hub_record_heads(kind,id)) STRICT;
CREATE TABLE hub_installation_state(object_id TEXT PRIMARY KEY REFERENCES hub_current_objects(object_id), kind TEXT NOT NULL DEFAULT 'SoftwareInstallationRecord' CHECK(kind='SoftwareInstallationRecord'),
 management TEXT NOT NULL CHECK(management IN ('hub-managed','external')), presence_json TEXT NOT NULL CHECK(json_valid(presence_json)),
 compatibility_json TEXT NOT NULL CHECK(json_valid(compatibility_json)), latest_inspection_id TEXT REFERENCES hub_inspections(id), receipt_refs_json TEXT NOT NULL CHECK(json_valid(receipt_refs_json)), FOREIGN KEY(kind,object_id) REFERENCES hub_record_heads(kind,id)) STRICT;
CREATE TABLE hub_service_state(object_id TEXT PRIMARY KEY REFERENCES hub_current_objects(object_id), kind TEXT NOT NULL DEFAULT 'ServiceInstance' CHECK(kind='ServiceInstance'),
 management TEXT NOT NULL CHECK(management IN ('hub-managed','external')), desired_state TEXT NOT NULL CHECK(desired_state IN ('running','stopped','unmanaged')),
 runtime_json TEXT CHECK(runtime_json IS NULL OR json_valid(runtime_json)), FOREIGN KEY(kind,object_id) REFERENCES hub_record_heads(kind,id),
 CHECK(management!='external' OR desired_state='unmanaged')) STRICT;
CREATE TABLE hub_inspections(id TEXT PRIMARY KEY, software_id TEXT NOT NULL, software_revision INTEGER NOT NULL,
 host_id TEXT NOT NULL, host_revision INTEGER NOT NULL, source_id TEXT, source_revision INTEGER, build_id TEXT, build_revision INTEGER, subject_kind TEXT NOT NULL CHECK(subject_kind IN ('candidate','installation')),
 candidate_id TEXT, copy_identity TEXT, inspected_installation_id TEXT, inspected_installation_revision INTEGER,
 fingerprint_sha256 TEXT CHECK(fingerprint_sha256 IS NULL OR length(fingerprint_sha256)=64), scope_key TEXT NOT NULL, scope_complete INTEGER NOT NULL CHECK(scope_complete IN (0,1)),
 observed_at TEXT NOT NULL, valid_until TEXT NOT NULL, boot_id TEXT NOT NULL, adapter_digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('present','absent','unknown')), reasons_json TEXT NOT NULL CHECK(json_valid(reasons_json)),
 proof_json TEXT NOT NULL CHECK(json_valid(proof_json)), proof_sha256 TEXT NOT NULL, commit_id TEXT NOT NULL REFERENCES hub_commits(id),
 FOREIGN KEY(software_id,software_revision) REFERENCES hub_object_versions(object_id,object_revision),
 FOREIGN KEY(host_id,host_revision) REFERENCES hub_object_versions(object_id,object_revision),
 FOREIGN KEY(source_id,source_revision) REFERENCES hub_object_versions(object_id,object_revision),
 FOREIGN KEY(build_id,build_revision) REFERENCES hub_object_versions(object_id,object_revision),
 CHECK((source_id IS NULL)=(source_revision IS NULL)), CHECK((build_id IS NULL)=(build_revision IS NULL)),
 FOREIGN KEY(inspected_installation_id,inspected_installation_revision) REFERENCES hub_object_versions(object_id,object_revision),
 CHECK((subject_kind='candidate' AND candidate_id IS NOT NULL AND inspected_installation_id IS NULL AND inspected_installation_revision IS NULL) OR
 (subject_kind='installation' AND candidate_id IS NULL AND inspected_installation_id IS NOT NULL AND inspected_installation_revision IS NOT NULL)),
 CHECK(state!='present' OR copy_identity IS NOT NULL)) STRICT;
CREATE TABLE hub_inspection_associations(inspection_id TEXT PRIMARY KEY REFERENCES hub_inspections(id), installation_id TEXT NOT NULL, object_revision INTEGER NOT NULL,
 commit_id TEXT NOT NULL REFERENCES hub_commits(id), FOREIGN KEY(installation_id,object_revision) REFERENCES hub_object_versions(object_id,object_revision)) STRICT;
CREATE INDEX hub_inspection_lookup ON hub_inspections(software_id,host_id,observed_at);
CREATE TABLE hub_connections(id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'Connection' CHECK(kind='Connection'), label TEXT NOT NULL,
 target_id TEXT NOT NULL, target_scope TEXT NOT NULL CHECK(target_scope IN ('local','external-unresolved')), adapter_ref TEXT NOT NULL, endpoint TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), credential_ref TEXT, endpoint_policy_ref TEXT, FOREIGN KEY(kind,id) REFERENCES hub_record_heads(kind,id)) STRICT;
CREATE INDEX hub_connection_target ON hub_connections(target_id);
CREATE TABLE hub_operations(id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'SetupOperation' CHECK(kind='SetupOperation'), action TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reviewed','applying','complete','reconciliation-required','cancelled')), outcome TEXT CHECK(outcome IN ('succeeded','failed','unknown')),
 target_refs_json TEXT NOT NULL CHECK(json_valid(target_refs_json)), expected_targets_json TEXT NOT NULL CHECK(json_valid(expected_targets_json)),
 plan_artifact_id TEXT, receipt_refs_json TEXT NOT NULL CHECK(json_valid(receipt_refs_json)), error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(kind,id) REFERENCES hub_record_heads(kind,id)) STRICT;
CREATE INDEX hub_operation_state ON hub_operations(state,updated_at);
CREATE TABLE hub_setup_drafts(id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=0), step TEXT NOT NULL,
 selection_json TEXT NOT NULL CHECK(json_valid(selection_json))) STRICT;
CREATE TABLE hub_adapter_bindings(handle TEXT PRIMARY KEY, owner_id TEXT NOT NULL, adapter_ref TEXT NOT NULL, binding_json TEXT NOT NULL CHECK(json_valid(binding_json))) STRICT;
CREATE VIEW hub_inventory_current AS SELECT p.object_id,p.object_revision,h.revision AS record_revision,p.profile_id,p.projected_json,s.management,s.presence_json,s.compatibility_json
 FROM hub_projections p JOIN hub_record_heads h ON h.kind=p.kind AND h.id=p.object_id JOIN hub_installation_state s ON s.object_id=p.object_id
 WHERE p.kind='SoftwareInstallationRecord';
PRAGMA user_version=4;
COMMIT;
