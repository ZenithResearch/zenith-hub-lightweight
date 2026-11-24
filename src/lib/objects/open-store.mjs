/** Explicit opt-in only. Selecting the foundation never migrates an existing v2 database. */
import {ObjectStore} from './store.mjs';
import {HubRepository} from './repository.mjs';
export async function openObjectStore({env,registry,registryFile}) {
  const {applicationForEnv,activation,setupRoot,assertNoPendingMigration}=await import('../application/owner.mjs');
  if(env.ZENITH_HUB_APPLICATION_DB==='1'||await activation(setupRoot(env)))return (await applicationForEnv(env)).repository;
  await assertNoPendingMigration(setupRoot(env));
  return env.ZENITH_HUB_REPOSITORY_FOUNDATION==='1'
    ? HubRepository.open({dataDir:env.ZENITH_HUB_DATA_DIR,registryFile})
    : new ObjectStore({dataDir:env.ZENITH_HUB_DATA_DIR,registry});
}
