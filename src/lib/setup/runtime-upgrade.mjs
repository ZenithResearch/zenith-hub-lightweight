import path from 'node:path';
import {lstat, readFile} from 'node:fs/promises';
import {check, digest} from './catalog.mjs';
import {readPrivate} from './state.mjs';

export const runtimeChange = action => ['upgrade-runtime', 'rollback-runtime'].includes(action);
const configFiles = ['receiver.json', 'admission.json', 'readiness-trust.json'];

export async function prepareRuntimeChange(root, item, action, env) {
  check(item, item.componentId === 'process-runtime' && item.mode === 'install', 'managed_runtime_required');
  const instance = path.join(root, 'instances', item.instanceId);
  const receiptBytes = await readPrivate(path.join(instance, 'receipt.json'));
  const receipt = JSON.parse(receiptBytes);
  check(receipt, receipt.root === instance && receipt.instanceId === item.instanceId &&
    receipt.componentId === item.componentId && receipt.configured && receipt.installed, 'runtime_identity_changed');
  const release = JSON.parse(await readFile('profiles/setup/process-runtime-upgrade.json','utf8'));
  const rollback = action === 'rollback-runtime';
  const active = receipt.runtimeRelease;
  check(receipt, rollback ? active?.commit === release.commit : !active, 'unexpected_runtime_generation');
  const baseline = rollback ? release.wheels : release.baseArtifacts;
  const identity = rows => rows.map(r => r.filename + ':' + r.sha256).sort().join('\n');
  check(receipt, identity(receipt.artifacts) === identity(baseline), 'unsupported_runtime_baseline');
  const current = rollback ? release.commit : release.baseCommit, target = rollback ? release.baseCommit : release.commit;
  const effects = [
    'Switch Process Runtime from ' + current + ' to ' + target + '.',
    'Keep ' + path.join(instance,'data/runtime.db') + ' and port ' + item.config.port + '. Back up data and configuration before switching.',
    'Rollback target: ' + current + '. Startup is a separate action.',
  ];
  const prerequisites = [];
  const artifacts = [];
  const config = {};
  if (!rollback) {
    const cache = env.ZENITH_SETUP_RUNTIME_WHEELHOUSE || path.join(root, 'cache/runtime-upgrades', target);
    check(cache, path.isAbsolute(cache), 'invalid_runtime_wheelhouse');
    for (const wheel of release.wheels) {
      const file = path.join(cache,wheel.filename);
      artifacts.push({...wheel,path:file});
      try {
        const s = await lstat(file);
        if (!s.isFile() || s.size !== wheel.bytes || digest(await readFile(file)) !== wheel.sha256) throw Error();
      } catch { prerequisites.push('Supply the pinned wheel ' + wheel.filename + ' in ' + cache + '.'); }
    }
    for (const name of configFiles) {
      try {
        const bytes = await readPrivate(path.join(instance,'config',name));
        config[name] = digest(bytes);
        if (name === 'receiver.json') {
          const pin = JSON.parse(bytes).native_verifier?.sha256;
          if (pin !== release.verifierSha256) prerequisites.push('Use the reviewed native verifier ' + release.verifierSha256 + '.');
          else effects.push('Native verifier SHA-256: ' + pin);
        }
        if (name === 'admission.json' && JSON.parse(bytes).enabled !== false)
          prerequisites.push('Close new-run admission before upgrading.');
      }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (Object.keys(config).length && Object.keys(config).length !== configFiles.length)
      prerequisites.push('Supply receiver.json, admission.json and readiness-trust.json together.');
    effects.push(Object.keys(config).length ? 'Launch with the reviewed receiver, admission and readiness trust files: ' + Object.entries(config).map(([k,v])=>k+' '+v).join(', ') : 'Launch with default-deny authority and closed new-run admission.');
  }
  effects.push('Target wheels: ' + (rollback ? release.baseArtifacts : release.wheels).map(w=>w.filename+' '+w.sha256).join(', '));
  return {effects, prerequisites, artifacts, runtimeChange:{action, current, target, receiptSha256:digest(receiptBytes), config}};
}
