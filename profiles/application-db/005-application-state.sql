-- Private application bindings and compatibility views share the repository commit owner.
BEGIN IMMEDIATE;
CREATE TABLE hub_application_document_versions(
 document_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 kind TEXT NOT NULL CHECK(kind IN ('setup','resource-registry','review-plan','native-binding','migration','application')),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 commit_id TEXT NOT NULL REFERENCES hub_commits(id), PRIMARY KEY(document_key,revision)
) STRICT;
CREATE TABLE hub_application_documents(
 document_key TEXT PRIMARY KEY, revision INTEGER NOT NULL,
 FOREIGN KEY(document_key,revision) REFERENCES hub_application_document_versions(document_key,revision)
) STRICT;
PRAGMA user_version=5;
COMMIT;
