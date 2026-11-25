/** Explicit project-local runtime preparation, including CI's --ignore-scripts install path. */
import fs from 'node:fs/promises';
import {nativeLocation,verifyNativeFile} from '../src/lib/matrix/native-runtime.mjs';
const location=await nativeLocation();let valid=false;try{await verifyNativeFile(location.file,location.entry);valid=true;}catch{}
if(!valid){
 if(!process.argv.includes('--install'))throw Error('Run npm run matrix:prepare to install the pinned project-local crypto runtime.');
 const response=await fetch(location.entry.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Native crypto download failed');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>location.entry.size)throw Error('Native crypto download exceeds pinned size');chunks.push(chunk);}
 const file=location.file+'.verified-pending';await fs.writeFile(file,Buffer.concat(chunks),{flag:'wx',mode:0o644});
 try{await verifyNativeFile(file,location.entry);await fs.rename(file,location.file);}catch(e){await fs.unlink(file).catch(()=>{});throw e;}
}
console.log('Verified Matrix crypto '+location.version+' ('+location.key+')');
