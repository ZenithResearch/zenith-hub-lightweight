/** The CLI initializes/migrates first. A configured server never accepts requests against unready storage. */
export async function register() {
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.ZENITH_HUB_APPLICATION_DB==='1') {
  const {applicationForEnv}=await import('./lib/application/owner.mjs');
  await (await applicationForEnv()).status();
 }
}
