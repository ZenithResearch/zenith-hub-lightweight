// Bootstrap from a bare checkout using only Node built-ins.
import fs from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { operatorPort, processStamp, setupRoot } from './launcher-defaults.mjs';

function python312(override) {
  for (const command of override ? [override] : ['python3.12', 'python3']) {
    const result = spawnSync(command, ['-I', '-c',
      'import os, sys; assert sys.version_info[:2] == (3, 12); print(os.path.abspath(sys.executable))'],
      { encoding: 'utf8' });
    if (result.status === 0 && path.isAbsolute(result.stdout.trim())) return result.stdout.trim();
  }
  throw Error(override ? 'Configured Python must be an executable Python 3.12 interpreter: ' + override :
    'Install Python 3.12 and put python3.12 on PATH, then rerun npm run setup.');
}

async function existingHub(root) {
  let file;
  try { file = await fs.open(path.join(root, 'server.json'), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let lease;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 65536)
      throw Error('Cannot verify the private Hub server record at ' + root);
    lease = JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
  if (lease.schema !== 'zenith.hub-server.v1' || !lease.processStamp || !Number.isSafeInteger(lease.pid) || lease.pid < 1)
    throw Error('Invalid Hub server record at ' + root);
  if (processStamp(lease.pid) !== lease.processStamp) return;
  if (lease.source !== process.cwd()) throw Error('This Hub root is in use by ' + lease.source);
  const origin = 'http://127.0.0.1:' + operatorPort(lease.port);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(origin + '/api/database', {redirect: 'error', signal: AbortSignal.timeout(3000)});
      const status = await res.json();
      if (res.ok && status.ready && status.repositoryId === lease.repositoryId &&
          status.serverInstanceId === lease.serverInstanceId) return origin;
    } catch { /* The dev server may still be compiling the route. */ }
    await delay(500);
  }
  throw Error('The recorded Hub is running but its database readiness could not be verified at ' + origin);
}

async function checkPort(port) {
  const probe = net.createServer();
  try {
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw Error('Port ' + port + ' is busy. Choose a free ZENITH_OPERATOR_PORT and rerun setup.');
    throw error;
  }
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

function run(args, stage) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error(stage + ' failed. Correct the error above and rerun npm run setup.');
}

async function prepareDependencies() {
  const receipt = 'node_modules/.zenith-setup-lock';
  const digest = createHash('sha256').update(await fs.readFile('package-lock.json'))
    .update(process.version + process.arch + process.platform).digest('hex');
  const saved = await fs.readFile(receipt, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (saved !== digest || !existsSync('node_modules/next/dist/bin/next')) {
    console.log('Installing dependencies from package-lock.json');
    run([process.env.npm_execpath, 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], 'Locked npm install');
  }
  run(['scripts/matrix-native.mjs', '--install'], 'Matrix native dependency verification');
  await fs.writeFile(receipt, digest);
}

async function setup() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Local setup requires an Apple silicon Mac running an arm64 Node.js installation.');
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw Error('Select Node.js 24 and rerun npm run setup.');
  if (existsSync('.env.operator.local')) process.loadEnvFile('.env.operator.local');
  const root = setupRoot();
  const existing = await existingHub(root);
  if (existing) { console.log('Open Hub Settings at ' + existing + '/settings'); return; }
  const port = operatorPort();
  await checkPort(port);
  const python = python312(process.env.ZENITH_PROCESS_PYTHON);
  process.env.ZENITH_PROCESS_PYTHON = python;
  process.env.ZENITH_SETUP_PYTHON = process.env.ZENITH_SETUP_PYTHON ? python312(process.env.ZENITH_SETUP_PYTHON) : python;
  const lockPath = '.zenith-setup.lock';
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('Setup is already preparing this checkout. If it was interrupted, confirm it has exited, remove .zenith-setup.lock, and retry.');
    throw error;
  }
  try { await prepareDependencies(); }
  finally { await lock.close(); await fs.unlink(lockPath); }
  process.argv = [process.execPath, 'scripts/hub.mjs', 'serve', '--dev'];
  await import('./hub.mjs');
}

setup().catch(error => { console.error(error.message); process.exitCode = 1; });
