// Run from the commit under test. The fixture keeps only the host toolchain.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hub-clone-'));
const cwd = path.join(scratch, 'Hub source');
const home = path.join(scratch, 'Empty home');
const root = path.join(home, 'Library/Application Support/Zenith/Hub');
const env = { PATH: process.env.PATH, HOME: home, npm_config_cache: path.join(scratch, 'npm cache'),
  TMPDIR: path.join(scratch, 'tmp'), NEXT_TELEMETRY_DISABLED: '1' };
const children = [];
let stage = 'clone';

function launch(command, args, options = {}) {
  const proc = spawn(command, args, {cwd, env, detached: true, stdio: ['ignore','pipe','pipe'], ...options});
  children.push(proc);
  return proc;
}

async function until(description, get, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await get();
    if (result) return result;
    await delay(250);
  }
  throw Error('Timed out waiting for ' + description);
}

async function browserSettings(url) {
  // Chrome DevTools pipe uses NUL-terminated JSON on file descriptors 3/4.
  const chrome = launch(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--no-proxy-server',
     '--user-data-dir=' + path.join(scratch,'Chrome'), '--remote-debugging-pipe'],
    {stdio:['ignore','ignore','ignore','pipe','pipe']});
  let buffer = '', id = 0;
  const pending = new Map();
  chrome.stdio[4].setEncoding('utf8').on('data', chunk => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0,cut)); buffer = buffer.slice(cut+1);
      const resolve = pending.get(msg.id);
      if (resolve) { pending.delete(msg.id); resolve(msg); }
    }
  });
  async function send(method, params, sessionId) {
    const n = ++id;
    const response = new Promise(resolve => pending.set(n, resolve));
    chrome.stdio[3].write(JSON.stringify({id:n, method, params, sessionId})+'\0');
    const msg = await Promise.race([response, delay(30000, null, {ref:false})]);
    if (!msg || msg.error) throw Error('Chrome command failed: ' + method);
    return msg.result;
  }
  const {targetId} = await send('Target.createTarget',{url:'about:blank'});
  const {sessionId} = await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Page.enable',{},sessionId);
  const navigation = await send('Page.navigate',{url},sessionId);
  if (navigation.errorText) throw Error('Could not open printed URL: ' + navigation.errorText);
  let observed;
  try { await until('hydrated Settings and configured instances', async () => {
    const answer = await send('Runtime.evaluate',{expression:
      'location.href === '+JSON.stringify(url)+' && document.querySelector("h1")?.textContent === "Settings & configuration" && !!document.querySelector(\'a[href="/settings/history"]\') && document.body.innerText.includes("Configured instances")',
      returnByValue:true},sessionId);
    if (answer.result?.value) return true;
    observed = (await send('Runtime.evaluate',{expression:
      '({url:location.href,title:document.title,body:document.body?.innerText.slice(0,250)})',
      returnByValue:true},sessionId)).result?.value;
  },120000); } catch (error) {
    throw Error(error.message + ' (last browser observation ' + JSON.stringify(observed) + ')');
  }
}

try {
  await fs.mkdir(home,{mode:0o700});
  await fs.mkdir(env.TMPDIR,{mode:0o700});
  execFileSync('git',['clone','--quiet','--no-local','--depth','1','--',process.cwd(),cwd],{env});
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd,env,encoding:'utf8'}).trim(),
    execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());

  stage = 'busy port before install';
  const probe = net.createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const available = String(probe.address().port);
  try {
    const refused = launch('npm',['run','setup'],{env:{...env,ZENITH_OPERATOR_PORT:available}});
    let diagnostic='';
    refused.stderr.on('data',chunk=>{diagnostic+=chunk;});
    const exit = await new Promise(resolve=>refused.once('exit',resolve));
    assert.notEqual(exit,0);
    assert.match(diagnostic,/Port \d+ is busy/);
    for (const item of [root,path.join(cwd,'node_modules')])
      await assert.rejects(fs.access(item),{code:'ENOENT'});
  } finally { await new Promise(resolve=>probe.close(resolve)); }

  // CI uses the documented default. Local rehearsals can share a machine with a live Hub.
  if (process.argv.includes('--free-port')) env.ZENITH_OPERATOR_PORT = available;
  stage = 'npm run setup';
  const server = launch('npm',['run','setup']);
  let output = '';
  function capture(chunk) { process.stdout.write(chunk); output = (output+chunk).slice(-65536); }
  server.stdout.on('data',capture); server.stderr.on('data',capture);
  const url = await until('launcher Settings URL',()=>{
    if (server.exitCode !== null || server.signalCode) throw Error('Launcher exited during setup');
    return output.match(/Open Hub Settings at (http:\/\/127\.0\.0\.1:\d+\/settings)/)?.[1];
  },480000);
  assert.equal(new URL(url).port,env.ZENITH_OPERATOR_PORT || '4318');

  stage = 'verify serving instance';
  const leaseFile = path.join(root,'server.json');
  const lease = JSON.parse(await fs.readFile(leaseFile,'utf8'));
  assert.equal(lease.source,cwd);
  await until('owned database',async()=>{
    try {
      const res = await fetch(new URL('/api/database',url),{signal:AbortSignal.timeout(5000)});
      const status = await res.json();
      return res.ok && status.ready && status.serverInstanceId === lease.serverInstanceId && status.repositoryId === lease.repositoryId;
    } catch { return false; }
  },100000);
  stage = 'browser';
  await browserSettings(url);
  stage = 'repeat setup';
  const repeat = execFileSync('npm',['run','setup'],{cwd,env,encoding:'utf8',timeout:60000});
  assert.ok(repeat.includes('Open Hub Settings at '+url));
  assert.deepEqual(JSON.parse(await fs.readFile(leaseFile,'utf8')),lease);
  stage = 'stop';
  execFileSync('npm',['run','hub','--','stop'],{cwd,env,timeout:30000});
  await until('owned launcher to stop',()=>server.exitCode !== null || server.signalCode,30000);
  await assert.rejects(fs.access(leaseFile),{code:'ENOENT'});
  console.log('PASS: fresh clone, busy-port diagnostic, live Settings, repeated setup, and stop');
} catch (error) {
  console.error('Clean-clone failure at stage "' + stage + '"'); throw error;
} finally {
  for (const child of children) {
    if (child.pid && child.exitCode === null && !child.signalCode) {
      try { process.kill(-child.pid,'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  await fs.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
