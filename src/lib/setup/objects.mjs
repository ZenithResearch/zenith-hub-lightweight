/** Observational environment projections. Service databases and invocation authority remain separate. */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readPrivate, atomic, privateDirectory } from "./state.mjs";
import { ObjectStore } from "../objects/store.mjs";
import { loadOntologyRegistry } from "../objects/registry.mjs";
const I = "https://zenith-research.ca/ontology/hub/infrastructure/terms/",
  Z = "https://zenith-research.ca/ontology/terms/",
  R = "http://www.w3.org/2000/01/rdf-schema#";
export async function projectEnvironment(root, instances, operation) {
  const {activation}=await import('../application/owner.mjs');if(await activation(root))return {owner:'HubRepository',publishedWithSetupCommit:true};
  const meta = path.join(root, "machine.json");
  let machine;
  try {
    machine = JSON.parse(await readPrivate(meta)).id;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    machine = "urn:zenith:hub:machine:" + randomUUID();
    await atomic(meta, { id: machine });
  }
  const registry = await loadOntologyRegistry(path.join(process.cwd(), "profiles/object-store/registry.json"));
  await privateDirectory(path.join(root, "objects"));
  const store = new ObjectStore({ dataDir: path.join(root, "objects"), registry });
  try {
    const graph = [{ "@id": machine, "@type": I + "Machine", [R + "label"]: [{ "@value": "This Hub host" }] }];
    for (const item of instances) {
      const id = "urn:zenith:hub:instance:" + item.instanceId;
      graph.push({ "@id": id, "@type": I + "ServiceInstance", [R + "label"]: [{ "@value": item.componentId + " / " + item.instanceId }],
        ...(item.mode !== "connect" ? { [I + "hostedBy"]: [{ "@id": machine }] } : {}) });
      if (item.mode !== "connect") {
        graph.push({ "@id": "urn:zenith:hub:deployment:" + item.instanceId, "@type": I + "Deployment", [I + "realizes"]: [{ "@id": id }], [I + "hostedBy"]: [{ "@id": machine }] });
        graph.push({ "@id": "urn:zenith:hub:data:" + item.instanceId, "@type": Z + "Collection", [R + "label"]: [{ "@value": "Operational data owned by " + item.componentId }] });
      }
    }
    const expectedRevisions = {};
    for (const node of graph) {
      try { expectedRevisions[node["@id"]] = (await store.get(node["@id"])).revision; }
      catch (e) { if (e.code !== "object_not_found") throw e; }
    }
    return await store.importDocument({ "@graph": graph }, { importKey: "setup-observation-" + operation, expectedRevisions, source: "hub-setup-observation", admission: "observation" });
  } finally { store.close(); }
}
