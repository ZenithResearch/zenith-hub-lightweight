/** Management authority follows the owned process/listener, never an API probe. */
import path from 'node:path';
import {readPrivate} from './state.mjs';
import {check} from './catalog.mjs';
export async function verifyMatrixListener(instance,{run}){
 try{
  const root=instance.root,marker=JSON.parse(await readPrivate(path.join(root,'process.json')));
  check(marker,Number.isSafeInteger(marker.pid)&&marker.pid>1&&Number.isSafeInteger(marker.childPid)&&marker.childPid>1,'matrix_local_listener_unverified');
  const started=(await run('/bin/ps',['-p',String(marker.pid),'-o','lstart='],{timeout:5000})).trim();
  const wrapper=await run('/bin/ps',['-ww','-p',String(marker.pid),'-o','command='],{timeout:5000});
  check(marker,started===marker.started&&wrapper.includes(path.join(root,'controller.py'))&&wrapper.includes('_serve'),'matrix_local_listener_unverified');
  const command=await run('/bin/ps',['-ww','-p',String(marker.childPid),'-o','command='],{timeout:5000});
  check(marker,command.includes(path.join(root,'venv/bin/python'))&&command.includes('synapse.app.homeserver')&&command.includes(path.join(root,'config/homeserver.yaml')),'matrix_local_listener_unverified');
  const listeners=(await run('/usr/sbin/lsof',['-nP','-a','-p',String(marker.childPid),'-iTCP:'+instance.config.port,'-sTCP:LISTEN','-t'],{timeout:5000})).trim().split(/\s+/);
  check(marker,listeners.includes(String(marker.childPid)),'matrix_local_listener_unverified');
  return {pid:marker.childPid,port:instance.config.port,authority:'owned-process-and-listener'};
 }catch{check(null,false,'matrix_local_listener_unverified',403);}
}
