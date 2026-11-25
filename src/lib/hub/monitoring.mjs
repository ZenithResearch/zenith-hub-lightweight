import os from 'node:os';
import path from 'node:path';
import {constants} from 'node:fs';
import {lstat, open, statfs} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {privateDirectory} from '../setup/state.mjs';

const week = 7 * 86400000;
const limit = 50000;
const pageSize = 40;
const databases = globalThis[Symbol.for('zenith.hub.monitoring.databases')] ||= new Map();
const writeFailures = globalThis[Symbol.for('zenith.hub.monitoring.failures')] ||= new Map();

async function openHistory(root) {
  const dir = path.join(root, 'monitoring');
  await privateDirectory(dir);
  const file = path.join(dir, 'checks.sqlite');
  const handle = await open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  await handle.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const stat = await lstat(file + suffix).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (stat && (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o077))) {
      throw Error('unsafe_monitoring_file');
    }
  }
  const db = new DatabaseSync(file, {timeout:1000, allowExtension:false});
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, service TEXT NOT NULL,
        step TEXT NOT NULL, reason TEXT, duration INTEGER NOT NULL, cpu REAL,
        memoryUsed INTEGER, memoryTotal INTEGER, diskUsed INTEGER, diskTotal INTEGER
      );
      CREATE INDEX IF NOT EXISTS checks_at ON checks(at);
      CREATE INDEX IF NOT EXISTS checks_failed ON checks(id) WHERE reason IS NOT NULL;
      CREATE TRIGGER IF NOT EXISTS prune_checks AFTER INSERT ON checks BEGIN
        DELETE FROM checks WHERE id <= NEW.id - 50000 OR at < NEW.at - 604800000;
      END;`);
    return db;
  } catch (error) { db.close(); throw error; }
}

function database(root) {
  if (!databases.has(root)) databases.set(root, openHistory(root).catch(error => {
    databases.delete(root);
    throw error;
  }));
  return databases.get(root);
}

function cpuTicks() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, ticks) => sum + ticks, 0);
  }
  return {idle, total};
}
async function cpuSample() {
  const start = cpuTicks();
  await delay(200);
  const end = cpuTicks(), total = end.total - start.total;
  return total > 0 ? Math.max(0, Math.min(100, 100 * (1 - (end.idle - start.idle) / total))) : null;
}
let sampling;
function sampleCPU() {
  if (!sampling) sampling = cpuSample().catch(() => null).finally(() => { sampling = null; });
  return sampling;
}
async function hostSample(root) {
  const total = os.totalmem(), used = total - os.freemem();
  const [cpu, disk] = await Promise.all([sampleCPU(), statfs(root).catch(() => null)]);
  return [cpu, total > 0 ? used : null, total || null,
    disk?.blocks ? (disk.blocks - disk.bfree) * disk.bsize : null,
    disk?.blocks ? disk.blocks * disk.bsize : null];
}

const errorKinds = {
  ECONNREFUSED:'Connection refused', ECONNRESET:'Connection reset', ENOTFOUND:'Host not found',
  ETIMEDOUT:'Timed out', TimeoutError:'Timed out', probe_timeout:'Timed out',
  response_too_large:'Response exceeds size limit', incompatible_contract:'Invalid response',
  matrix_session_expired:'Session expired', matrix_permission_denied:'Access denied',
  matrix_rate_limited:'Rate limited', authentication_failed:'Authentication failed',
  access_denied:'Access denied', not_ready:'Service not ready', api_rejected:'Request rejected',
  private_remote_endpoint:'Endpoint policy denied', unsafe_endpoint:'Endpoint policy denied'
};
export function checkFailure(error) {
  for (const key of [error?.code, error?.resourceState, error?.cause?.code, error?.name, error?.message]) {
    if (Object.hasOwn(errorKinds, key)) return errorKinds[key];
  }
  return 'Check failed';
}

export const unchecked = (_step, run) => run();

// Wrap the actual read. Cache hits, disabled services and catalog entries never produce samples.
export function serviceMonitor(env, service) {
  const root = env.ZENITH_HUB_SETUP_DIR;
  if (!root || env.ZENITH_LOCAL_OPERATOR !== '1') return unchecked;
  return async (step, run, assess = () => null) => {
    const started = performance.now();
    let reason = null;
    try {
      const result = await run();
      reason = assess(result);
      return result;
    } catch (error) {
      reason = checkFailure(error);
      throw error;
    } finally {
      const at = Date.now(), duration = Math.round(performance.now() - started);
      try {
        const [db, metrics] = await Promise.all([database(root), hostSample(root)]);
        db.prepare('INSERT INTO checks (at,service,step,reason,duration,cpu,memoryUsed,memoryTotal,diskUsed,diskTotal) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(at, service, step, reason, duration, ...metrics);
      } catch {
        writeFailures.set(root, at);
      }
    }
  };
}

export async function readHistory(root, {before = null, failures = false, service = null} = {}) {
  const db = await database(root);
  const since = Date.now() - week;
  const terms = ['at >= ?'], params = [since];
  if (before !== null) { terms.push('id < ?'); params.push(before); }
  if (failures) terms.push('reason IS NOT NULL');
  if (service !== null) { terms.push('service = ?'); params.push(service); }
  const rows = db.prepare('SELECT * FROM checks WHERE ' + terms.join(' AND ') + ' ORDER BY id DESC LIMIT ?')
    .all(...params, pageSize + 1);
  const events = rows.slice(0, pageSize);
  return {events, older:rows.length > pageSize ? events.at(-1).id : null,
    services:db.prepare('SELECT DISTINCT service FROM checks WHERE at >= ? ORDER BY service').all(since).map(r => r.service),
    lastWriteFailure:writeFailures.get(root) || null, maxRecords:limit, retentionDays:7};
}
