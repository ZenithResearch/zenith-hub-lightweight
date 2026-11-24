import Ajv from 'ajv/dist/2020.js';
import schema from '../../../profiles/setup/matrix.schema.json' with {type:'json'};
const bindingValidator=new Ajv({strict:true}).compile(schema);
export const validateMatrixBinding=value=>check(value,bindingValidator(value),'matrix_binding_invalid',422);
import {check} from './catalog.mjs';
const closed=(v,required,optional=[])=>check(v,v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>[...required,...optional].includes(k)),'matrix_invalid_action',400);
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\0\r\n]/.test(v);
export function validateMatrixAction(action,args){
 const rules={
  login:[['method'],['username']],
  bootstrap:[['username','admin'],[]],
  'create-room':[['name','visibility','joinRule','encryption'],['topic','acknowledgeEncryption']],
  'create-space':[['name','visibility','joinRule','encryption'],['topic','acknowledgeEncryption']],
  'join-room':[['roomId'],[]],
  'select-room':[['roomId'],['spaceId']],
  'select-space':[['spaceId'],[]],
  'configure-room':[['roomId'],['name','topic','joinRule','visibility']],
  'link-room':[['roomId','spaceId'],[]],
  'unlink-room':[['roomId','spaceId'],[]],
  membership:[['roomId','userId','membership'],['reason']],
  permissions:[['roomId','userId','level'],[]],
  'enable-encryption':[['roomId','acknowledgeEncryption'],[]],
  'message-test':[['roomId','acknowledgeSend'],[]],
  logout:[['revokeExternal'],[]],
  'acknowledge-outcome':[['operationId','acknowledge'],[]]
 };
 check(action,Object.hasOwn(rules,action),'matrix_action_unsupported',400);closed(args,...rules[action]);
 for(const key of ['roomId','spaceId'])if(args[key]!==undefined)check(args,text(args[key])&&(/^[!#][^:]+:.+/.test(args[key])),'matrix_invalid_room',400);
 if(args.userId!==undefined)check(args,text(args.userId)&&/^@[^:]+:.+/.test(args.userId),'matrix_invalid_user',400);
 if(args.name!==undefined)check(args,text(args.name,200),'matrix_invalid_name',400);
 if(args.topic!==undefined)check(args,typeof args.topic==='string'&&args.topic.length<=1000&&!args.topic.includes('\0'),'matrix_invalid_topic',400);
 if(args.reason!==undefined)check(args,text(args.reason,500),'matrix_invalid_reason',400);
 if(args.username!==undefined)check(args,text(args.username,255),'matrix_invalid_user',400);
 if(action==='login')check(args,['m.login.password','m.login.token','access-token'].includes(args.method)&&(args.method!=='m.login.password'||text(args.username,255)),'matrix_login_method_unsupported',400);
 if(action==='bootstrap')check(args,/^[a-z0-9._=-]{1,255}$/.test(args.username)&&typeof args.admin==='boolean','matrix_bootstrap_privilege_selection_required',400);
 if(args.joinRule!==undefined)check(args,['invite','public','knock'].includes(args.joinRule),'matrix_join_rule_unsupported',400);
 if(args.visibility!==undefined)check(args,['private','public'].includes(args.visibility),'matrix_invalid_visibility',400);
 if(args.encryption!==undefined)check(args,typeof args.encryption==='boolean','matrix_invalid_encryption',400);
 if(args.encryption||action==='enable-encryption')check(args,args.acknowledgeEncryption===true,'matrix_encryption_acknowledgement_required',400);
 if(action==='membership')check(args,['invite','kick','ban','unban'].includes(args.membership),'matrix_invalid_membership',400);
 if(action==='permissions')check(args,Number.isSafeInteger(args.level),'matrix_invalid_power_level',400);
 if(action==='message-test')check(args,args.acknowledgeSend===true&&args.roomId.startsWith('!'),'matrix_message_acknowledgement_required',400);
 if(action==='logout')check(args,typeof args.revokeExternal==='boolean','matrix_logout_acknowledgement_required',400);
 if(action==='acknowledge-outcome')check(args,text(args.operationId)&&args.acknowledge===true,'matrix_reconciliation_acknowledgement_required',400);
 return args;
}
export const matrixActionEffects={
 login:'Authenticate the account with this server and retain its session in the private credential store. No account is created.',
 bootstrap:'Create the selected account on this Hub-managed local Synapse server. Administrative privileges are exactly those selected. Public registration stays disabled.',
 'create-room':'Create a room on the Matrix homeserver with the reviewed name, directory visibility, join rule and encryption.',
 'create-space':'Create a Matrix space with the reviewed name and join rule.',
 'join-room':'Join the selected room or accept its invitation using this account.',
 'select-space':'Save the verified joined space in the Hub without changing its membership.',
 'select-room':'Save this verified room selection in the Hub. No homeserver state is changed.',
 'configure-room':'Update only the reviewed room fields. Directory visibility and join rules are independent. Server permissions apply to every step.',
 'unlink-room':'Remove only the selected m.space.child and m.space.parent relationships. Retain both rooms, membership, messages and encryption. Partial completion remains visible.',
 'link-room':'Write m.space.child on the space and m.space.parent on the room. Either step can be denied; partial completion is retained.',
 membership:'Apply the selected membership action to the named user. Server-side membership and power checks remain authoritative.',
 permissions:'Merge the selected user’s power level into the current room power-level state.',
 'enable-encryption':'Enable Matrix room encryption. This is irreversible through the Hub. Messages and device/key verification require an external E2EE-capable Matrix client.',
 'message-test':'Send “Zenith Hub connection verification.” to the selected unencrypted room, then fetch that exact event. Send and read results are recorded separately.',
 logout:'Revoke only this Matrix session at the homeserver, then forget its active Hub binding. A supplied session may also be used by another client; explicit acknowledgement is required.',
 'acknowledge-outcome':'Acknowledge the retained uncertain/partial outcome after checking the account and rooms. Do not repeat the remote action automatically.'
};
