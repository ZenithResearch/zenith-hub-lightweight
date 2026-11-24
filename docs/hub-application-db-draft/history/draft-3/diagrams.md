# Hub database and ontology diagrams — draft 3

Review-only. Logical relational projection, not implemented SQL. Current snapshots cannot mix atomic-unit revisions. All classes are existing Core or proposed Infrastructure; the new app vocabulary declares properties only and is not registered/published. Observation admission only.

## A — Application database / logical relational projection

Edges are application references, not inheritance. Object-version links are expanded in D. Embedded arrays/objects remain JSON values in this logical view. Catalog IDs identify application catalog configuration; generic target/plan/receipt/evidence references follow typed local/external resolution rules.

```mermaid
erDiagram
    HubSettings {
        IRI id PK
        integer revision
        string label
        IRI localHostRef FK "optional"
        IRI selectedGuideProfileRef FK "optional"
    }
    Host {
        IRI id PK
        integer revision
        string label
        string kind
        ObjectVersion objectVersion
    }
    SoftwareDescriptor {
        IRI id PK
        integer revision
        string key
        string label
        string publisher "optional"
        string repository "optional"
        ObjectVersion objectVersion
    }
    SoftwareCatalogEntry {
        IRI id PK
        integer revision
        json catalogId
        string key
        IRI softwareRef FK
        IRI adapterRef
        json supportedModes
    }
    SoftwareSourceSnapshot {
        IRI id PK
        integer revision
        IRI softwareRef FK
        string repository
        string commit
        string version "optional"
        string manifestSha256 "optional"
        ObjectVersion objectVersion
    }
    SoftwareBuild {
        IRI id PK
        integer revision
        IRI softwareRef FK
        IRI sourceSnapshotRef FK "optional"
        json content
        string platform "optional"
        string version "optional"
        ObjectVersion objectVersion
    }
    SoftwareInstallationRecord {
        IRI id PK
        integer revision
        IRI softwareRef FK
        IRI hostRef FK
        string management
        json locations
        json presence
        json compatibility
        json receiptRefs "optional"
        ObjectVersion objectVersion
        IRI sourceSnapshotRef FK "optional"
        IRI buildRef FK "optional"
    }
    ConfigurationProfile {
        IRI id PK
        integer revision
        IRI softwareRef FK
        IRI installationRef FK "optional"
        string name
        IRI configArtifactRef "optional"
        string nativeHome "optional"
        json credentialRefs "optional"
        ObjectVersion objectVersion
        string profileKind
        json modelBinding "Hermes only"
    }
    ServiceInstance {
        IRI id PK
        integer revision
        IRI softwareRef FK
        IRI installationRef FK "optional"
        IRI profileRef FK "optional"
        string label
        string management
        json hostRefs FK "optional"
        string desiredState
        json runtime "optional"
        ObjectVersion objectVersion
    }
    Connection {
        IRI id PK
        integer revision
        string label
        IRI targetRef
        IRI adapterRef
        string endpoint
        boolean enabled
        IRI credentialRef "optional"
        IRI endpointPolicyRef "optional"
        string targetScope
    }
    SetupOperation {
        IRI id PK
        integer revision
        string action
        json targetRefs
        string state
        string outcome "optional"
        string createdAt
        string updatedAt
        IRI planArtifactRef "optional"
        json receiptRefs "optional"
        json error "optional"
    }
    Host o|--o{ HubSettings : localHostRef
    ConfigurationProfile o|--o{ HubSettings : selectedGuideProfileRef
    SoftwareDescriptor ||--o{ SoftwareCatalogEntry : softwareRef
    SoftwareDescriptor ||--o{ SoftwareSourceSnapshot : softwareRef
    SoftwareDescriptor ||--o{ SoftwareBuild : softwareRef
    SoftwareSourceSnapshot o|--o{ SoftwareBuild : sourceSnapshotRef
    SoftwareDescriptor ||--o{ SoftwareInstallationRecord : softwareRef
    Host ||--o{ SoftwareInstallationRecord : hostRef
    SoftwareSourceSnapshot o|--o{ SoftwareInstallationRecord : sourceSnapshotRef
    SoftwareBuild o|--o{ SoftwareInstallationRecord : buildRef
    SoftwareDescriptor ||--o{ ConfigurationProfile : softwareRef
    SoftwareInstallationRecord o|--o{ ConfigurationProfile : installationRef
    SoftwareDescriptor ||--o{ ServiceInstance : softwareRef
    SoftwareInstallationRecord o|--o{ ServiceInstance : installationRef
    ConfigurationProfile o|--o{ ServiceInstance : profileRef
    Host }o--o{ ServiceInstance : hostRefs
    Connection o|--o{ ConfigurationProfile : Hermes_model_server
```

## B — Ontology inheritance / existing Core + proposed Hub Infrastructure



```mermaid
flowchart TB
    Thing["owl:Thing"]
    zn_Entity["zn:Entity"]
    zn_Person["zn:Person"]
    zn_Organization["zn:Organization"]
    zn_Agent["zn:Agent"]
    zn_Artifact["zn:Artifact"]
    zn_ExternalLink["zn:ExternalLink"]
    zn_Receipt["zn:Receipt"]
    zn_Event["zn:Event"]
    zn_Domain["zn:Domain"]
    zn_Collection["zn:Collection"]
    zn_Handoff["zn:Handoff"]
    zn_Actor["zn:Actor"]
    infra_Machine["infra:Machine"]
    infra_ServiceInstance["infra:ServiceInstance"]
    infra_Deployment["infra:Deployment"]
    infra_Network["infra:Network"]
    infra_NetworkInterface["infra:NetworkInterface"]
    infra_StorageVolume["infra:StorageVolume"]
    infra_DNSZone["infra:DNSZone"]
    CoreModule["Core module — existing"]
    InfraModule["Infrastructure — proposed / unpublished"]
    AppRelations["Application relations — REVIEW ONLY / properties, no classes"]
    Thing -->|"parent → subclass"| zn_Entity
    zn_Entity -->|"parent → subclass"| zn_Person
    zn_Entity -->|"parent → subclass"| zn_Organization
    zn_Entity -->|"parent → subclass"| zn_Agent
    Thing -->|"parent → subclass"| zn_Artifact
    Thing -->|"parent → subclass"| zn_ExternalLink
    zn_Artifact -->|"parent → subclass"| zn_Receipt
    Thing -->|"parent → subclass"| zn_Event
    Thing -->|"parent → subclass"| zn_Domain
    Thing -->|"parent → subclass"| zn_Collection
    zn_Artifact -->|"parent → subclass"| zn_Handoff
    zn_Actor -.->|"owl:equivalentClass"| zn_Entity
    zn_Entity -->|"parent → subclass"| infra_Machine
    zn_Agent -->|"parent → subclass"| infra_ServiceInstance
    Thing -->|"parent → subclass"| infra_Deployment
    Thing -->|"parent → subclass"| infra_Network
    Thing -->|"parent → subclass"| infra_NetworkInterface
    Thing -->|"parent → subclass"| infra_StorageVolume
    Thing -->|"parent → subclass"| infra_DNSZone
    InfraModule ==>|"owl:imports"| CoreModule
    AppRelations -.->|"proposed import"| CoreModule
    AppRelations -.->|"proposed import"| InfraModule
```

## C — Semantic RDF relationships / schema roles, not ontology subclasses

Nodes are application schema roles with ontology types, not new ontology classes. Solid arrows are RDF predicates; dashed arrows are sidecar implementation bindings.

```mermaid
flowchart TB
    Host["Host<br/>infra:Machine"]
    Descriptor["Software descriptor<br/>zn:Artifact"]
    Source["Source snapshot<br/>zn:Artifact"]
    Build["Build output<br/>zn:Artifact"]
    Installation["Installation description<br/>zn:Artifact"]
    Profile["Named configuration<br/>zn:Artifact"]
    Service["Operational service<br/>infra:ServiceInstance"]
    ConfigContent["Separate configuration content<br/>zn:Artifact"]
    Bindings["Paths · credentials · model binding<br/>versioned sidecar values"]
    Source -->|"app:describesSoftware"| Descriptor
    Build -->|"app:describesSoftware"| Descriptor
    Build -->|"app:sourceSnapshot"| Source
    Installation -->|"app:describesSoftware"| Descriptor
    Installation -->|"app:installationHost"| Host
    Installation -->|"app:sourceSnapshot"| Source
    Installation -->|"app:installedBuild"| Build
    Profile -->|"app:describesSoftware"| Descriptor
    Profile -->|"app:installationRecord"| Installation
    Profile -->|"app:configurationContent"| ConfigContent
    Service -->|"app:describesSoftware"| Descriptor
    Service -->|"app:installationRecord"| Installation
    Service -->|"app:configurationProfile"| Profile
    Service -->|"infra:hostedBy"| Host
    Installation -.->|"locations"| Bindings
    Profile -.->|"nativeHome / credentialRefs / modelBinding"| Bindings
```

## D — Stored-object version contract / proposed, not implemented storage



```mermaid
flowchart TB
    Row["Ontology-backed application row"]
    Selection["Current selectedObjects<br/>objectId + objectRevision"]
    Object["StoredObjectRecord<br/>object identity + revision"]
    Unit["AtomicUnitVersion<br/>one compatible revision per current unit"]
    RDF["Immutable JSON-LD<br/>semantic facts and declared links"]
    Bindings["Immutable bindings file<br/>profile ID + validated values"]
    Defs["Pinned definition files<br/>modules / schemas / manifests"]
    View["Validated application view<br/>RDF + profile values"]
    Ops["Operational overlay<br/>inspection / desired state / journals"]
    Row -->|"objectVersion: objectId + revision + profileId"| Object
    Selection -->|"selects exact current object revision"| Object
    Object -->|"committed atomicUnit id + revision"| Unit
    Object -->|"jsonldFile — hash / length / media type"| RDF
    Object -->|"bindingsFile — same object / unit revision"| Bindings
    Object -->|"trusted exact definition references"| Defs
    RDF -->|"mapped semantic facts"| View
    Bindings -->|"validated profile / implementation values"| View
    Defs -->|"type and schema validation"| View
    View -->|"must equal object-backed columns"| Row
    Ops -.->|"explicitly owned operational fields"| Row
```

