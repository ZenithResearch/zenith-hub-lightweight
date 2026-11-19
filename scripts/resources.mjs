/** Owner-side resource registration. This command never starts or stops providers. */
import {changeRegistry,readRegistry,publicResource} from "../src/lib/resource-registry.mjs";
const [operation,...raw]=process.argv.slice(2);
const flags={};
for(let i=0;i<raw.length;i+=2) {
  if(!raw[i]?.startsWith("--") || !raw[i+1] || flags[raw[i]])throw Error("Expected unique named flag/value pairs");
  flags[raw[i]]=raw[i+1];
}
const allowed=new Set(["--config","--id","--label","--endpoint","--credential-file"]);
if(Object.keys(flags).some(k=>!allowed.has(k)) || !flags["--config"])throw Error("Use --config and supported resource flags");
let registry;
if(operation==="list")registry=await readRegistry(flags["--config"]);
else if(operation==="register") {
  if(!["--id","--label","--endpoint","--credential-file"].every(k=>flags[k]))throw Error("Registration requires id, label, endpoint and credential file");
  const resource={id:flags["--id"],label:flags["--label"],kind:"devgraph",endpoint:flags["--endpoint"],
    credentialFile:flags["--credential-file"],lifecycle:"external",enabled:true};
  registry=await changeRegistry(flags["--config"],{operation,resourceId:resource.id,resource});
} else if(["connect","disconnect","forget"].includes(operation)) {
  if(!flags["--id"])throw Error("Select --id");
  registry=await changeRegistry(flags["--config"],{operation:operation==="forget"?"forget":"set-enabled",
    resourceId:flags["--id"],enabled:operation==="connect"});
} else throw Error("Use register, list, connect, disconnect or forget");
console.log(JSON.stringify({schema:registry.schema,revision:registry.revision,resources:registry.resources.map(publicResource)},null,2));
