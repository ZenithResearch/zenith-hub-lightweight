/** Preserve the public operator error contract across Next module/realm boundaries. */
export function operatorFailure(error) {
 if(!error||typeof error!=='object')return null;
 const {code,status,details}=error;
 if(typeof code!=='string'||!/^[a-z][a-z0-9_]{0,127}$/.test(code)||!Number.isInteger(status)||status<400||status>599)return null;
 return {code,status,details};
}
