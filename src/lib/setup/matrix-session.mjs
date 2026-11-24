/** Opaque per-Hub credential binding. Tokens never enter setup, reviews or JSON-LD. */
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {atomic,privateDirectory,readPrivate} from './state.mjs';
import {serviceEndpoint} from './connections.mjs';
import {check,digest} from './catalog.mjs';
export async function saveMatrixSession(root,value){
 const directory=path.join(root,'credentials/matrix');await privateDirectory(directory);
 const ref=randomBytes(24).toString('hex');await atomic(path.join(directory,ref+'.json'),value);return ref;
}
export async function readMatrixSession(root,instance){
 const account=instance.matrix?.account,base=serviceEndpoint(instance);
 if(!account||account.endpoint!==base)return null;
 check(account,/^[a-f0-9]{48}$/.test(account.credentialRef||''),'matrix_session_binding_invalid');
 const session=JSON.parse(await readPrivate(path.join(root,'credentials/matrix',account.credentialRef+'.json'),16384));
 check(session,session.endpoint===base&&session.userId===account.userId&&typeof session.token==='string'&&account.credentialDigest===digest(session),'matrix_session_binding_invalid');
 return session;
}
