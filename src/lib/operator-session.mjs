/** CSRF sessions belong to a local operator process/root, not a Next route bundle. */
import {randomBytes} from 'node:crypto';
const sessions=globalThis[Symbol.for('zenith.hub.operator.sessions')] ||= new Map();
export function operatorCsrf(kind,env=process.env) {
 const scope=JSON.stringify([kind,env.ZENITH_OPERATOR_ORIGIN,env.ZENITH_HUB_SETUP_DIR,env.ZENITH_HUB_DATA_DIR,env.ZENITH_HUB_RESOURCES_FILE,env.ZENITH_HUB_APPLICATION_DB,env.ZENITH_HUB_SERVER_INSTANCE]);
 if(!sessions.has(scope))sessions.set(scope,randomBytes(24).toString('hex'));
 return sessions.get(scope);
}
