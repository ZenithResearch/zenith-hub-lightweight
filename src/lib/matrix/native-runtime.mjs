/** Verify the versioned official native binary before loading any encryption code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {check} from '../setup/catalog.mjs';
export async function verifyNativeFile(file,entry){const bytes=await fs.readFile(file);check(bytes,bytes.length===entry.size&&createHash('sha256').update(bytes).digest('hex')===entry.sha256,'matrix_chat_native_changed');}
export async function nativeLocation(){
 const manifest=JSON.parse(await fs.readFile(path.join(process.cwd(),'profiles/matrix-chat/native-crypto.json'),'utf8')),key=process.platform+'-'+process.arch,entry=manifest.platforms[key];
 check(entry,!!entry&&(process.platform!=='linux'||!!process.report.getReport().header.glibcVersionRuntime),'matrix_chat_native_unsupported');
 const require=createRequire(import.meta.url),pkg=require.resolve('@matrix-org/matrix-sdk-crypto-nodejs/package.json'),version=JSON.parse(await fs.readFile(pkg,'utf8')).version;check(version,version===manifest.version,'matrix_chat_native_changed');return {entry,file:path.join(path.dirname(pkg),entry.filename),version,key};
}
export async function verifyNativeCrypto(){const location=await nativeLocation();await verifyNativeFile(location.file,location.entry);return location;}
