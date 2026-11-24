/** Read-only receipt/closure mapping; no Git identity is invented for a source archive. */
import path from 'node:path';
import {readFile,lstat} from 'node:fs/promises';
import {check,digest} from './catalog.mjs';
import {readPrivate} from './state.mjs';
export async function softwareFromSynapseReceipt(root,receipt) {
 check(receipt,receipt.componentId==='matrix'&&receipt.instanceId===path.basename(root)&&receipt.installed===true&&receipt.root===root,'matrix_receipt_identity_mismatch');
 check(receipt,Array.isArray(receipt.artifacts)&&receipt.artifacts.length>0,'matrix_artifacts_unknown');
 if(receipt.configured&&receipt.configProof){const proof=receipt.configProof;check(proof,proof.serverName&&digest(await readPrivate(path.join(root,'config/homeserver.yaml')) )===proof.configurationSha256&&path.isAbsolute(proof.signingKeyPath)&&proof.signingKeyPath.startsWith(root+path.sep)&&digest(await readPrivate(proof.signingKeyPath))===proof.signingKeySha256,'matrix_configuration_changed_reconcile');}
 const artifacts=[];
 for(const a of receipt.artifacts){
  check(a,path.basename(a.filename)===a.filename&&/^[a-f0-9]{64}$/.test(a.sha256),'matrix_artifact_invalid');
  const file=path.join(root,'wheels',a.filename),stat=await lstat(file),bytes=await readFile(file);
  check(a,stat.isFile()&&!stat.isSymbolicLink()&&digest(bytes)===a.sha256,'matrix_installed_artifacts_changed');
  artifacts.push({filename:a.filename,sha256:a.sha256,byteLength:bytes.length});
 }
 const wheel=artifacts.find(a=>/^matrix_synapse-/.test(a.filename));
 check(wheel,wheel,'matrix_build_unknown');
 const controller=await readPrivate(path.join(root,'controller.py'),2*1024**2);
 check(receipt,digest(controller)===receipt.controllerSha256,'matrix_controller_changed');
 check(receipt,(await lstat(path.join(root,'venv'))).isDirectory(),'matrix_environment_unknown');
 const entry=await lstat(path.join(root,'venv/lib/python3.12/site-packages/synapse/app/homeserver.py'));check(entry,entry.isFile()&&!entry.isSymbolicLink(),'matrix_entrypoint_missing');
 return {environment:path.join(root,'venv'),launcher:path.join(root,'controller.py'),copyId:receipt.copyId||digest(root+'|'+digest(artifacts)),build:{content:{id:'urn:sha256:'+wheel.sha256,sha256:wheel.sha256,byteLength:wheel.byteLength,mediaType:'application/zip'},platform:wheel.filename.split('-').slice(-3).join('-').replace(/\.whl$/,''),version:wheel.filename.split('-')[1]},closureDigest:digest(artifacts),...(receipt.provenance?{provenance:receipt.provenance}:{})};
}
