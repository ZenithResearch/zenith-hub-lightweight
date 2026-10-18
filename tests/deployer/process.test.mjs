import { test } from "node:test";
import {EventEmitter} from "node:events";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { executeOwned } from "../../src/lib/owned-process.mjs";
test("timeout reaps the controller and its descendant before releasing the call", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zenith-process-group-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, "child.pid");
  const source = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
  await assert.rejects(
    executeOwned(process.execPath, ["-e", source, pidFile], {
      timeout: 300,
      maxBuffer: 1024,
      env: { PATH: process.env.PATH },
      shell: false,
    }),
  );
  const pid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
test("output-limit failure also terminates the owned process group", async () => {
  await assert.rejects(
    executeOwned(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000)"],
      { timeout: 3000, maxBuffer: 1024, shell: false },
    ),
  );
});

test("unconfirmed group cleanup is consistently marked even for permission errors", async () => {
  const denied = () => {
    const e = new Error("denied");
    e.code = "EPERM";
    throw e;
  };
  await assert.rejects(
    executeOwned(
      process.execPath,
      ["-e", "process.exit(0)"],
      { timeout: 3000, maxBuffer: 1024, shell: false },
      { signalGroup: denied },
    ),
    { code: "OPERATOR_CLEANUP_UNRESOLVED" },
  );
});

test("optional stdin is exact bounded UTF8, while omitted stdin remains EOF",async()=>{
 const source="let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>text+=s);process.stdin.on('end',()=>process.stdout.write(text));";
 const input="private-process-\u03c0-"+"x".repeat(1000);
 const options={timeout:3000,maxBuffer:65536,input};
 const pending=executeOwned(process.execPath,["-e",source],options);options.input="changed-after-spawn";
 assert.equal((await pending).stdout,input);
 assert.equal((await executeOwned(process.execPath,["-e",source],{timeout:3000,maxBuffer:1024})).stdout,"");
 const maximum="x".repeat(65536);assert.equal((await executeOwned(process.execPath,["-e",source],{timeout:3000,maxBuffer:65536,input:maximum})).stdout,maximum);
});
test("invalid or oversized UTF8 input rejects before spawn",async()=>{
 let spawned=0;const spawnProcess=()=>{spawned++;throw Error("must not spawn")};
 for(const input of ["x".repeat(65537),"\u03c0".repeat(32769)])await assert.rejects(executeOwned("unused",[],{input},{spawnProcess}),{code:"OPERATOR_INPUT_TOO_LARGE"});
 for(const input of [null,Buffer.from("x"),"\ud800"])await assert.rejects(executeOwned("unused",[],{input},{spawnProcess}),{code:"OPERATOR_INVALID_INPUT"});
 assert.equal(spawned,0);
});
test("EPIPE is handled as a controlled input failure with group cleanup",async()=>{
 let input,stdio,signalled=0,killed=0;const spawnProcess=(file,args,options)=>{stdio=options.stdio;const child=new EventEmitter();child.pid=12345;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{killed++};child.stdin.end=data=>{input=Buffer.from(data);queueMicrotask(()=>{const e=new Error("write closed");e.code="EPIPE";child.stdin.emit("error",e);child.emit("close",0,null)})};return child};
 const signalGroup=()=>{signalled++;const e=new Error("gone");e.code="ESRCH";throw e};
 await assert.rejects(executeOwned("unused",[],{timeout:3000,maxBuffer:1024,input:"private"},{spawnProcess,signalGroup}),{code:"OPERATOR_INPUT_CLOSED"});assert.deepEqual(stdio,["pipe","pipe","pipe"]);assert.equal(input.toString(),"private");assert.equal(killed,1);assert.equal(signalled,2);
});

test("stdin input is read once before its byte validation and spawn",async()=>{
 let reads=0;const options={timeout:3000,maxBuffer:1024,get input(){reads++;return reads===1?"original-private-data":"changed-by-getter"}};const result=await executeOwned(process.execPath,["-e","process.stdin.pipe(process.stdout)"],options);assert.equal(result.stdout,"original-private-data");assert.equal(reads,1);
});
