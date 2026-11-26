import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function setupRoot(value = process.env.ZENITH_HUB_SETUP_DIR) {
  return path.resolve(value || path.join(os.homedir(), 'Library/Application Support/Zenith/Hub'));
}

export function operatorPort(value = process.env.ZENITH_OPERATOR_PORT) {
  const port = Number(value || 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('Set ZENITH_OPERATOR_PORT to a port between 1024 and 65535.');
  return port;
}

export async function servingOrigin(lease, signal, timeout = 90000) {
  const origin = 'http://127.0.0.1:' + operatorPort(lease.port);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !signal?.aborted) {
    const attempt = AbortSignal.timeout(5000);
    try {
      const response = await fetch(origin + '/api/database', { redirect: 'error',
        signal: signal ? AbortSignal.any([attempt, signal]) : attempt });
      const status = await response.json();
      if (response.ok && status.ready && status.repositoryId === lease.repositoryId &&
          status.serverInstanceId === lease.serverInstanceId) return origin;
    } catch { /* A fresh server may still be compiling the database route. */ }
    if (!signal?.aborted) await delay(400);
  }
  if (!signal?.aborted) throw Error('Could not verify Hub database readiness at ' + origin);
}

export function processStamp(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=,comm='], { encoding: 'utf8' });
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw Error('Could not verify the Hub process identity.');
  return result.status === 0 ? result.stdout.trim() : null;
}
