import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {serviceMonitor} from './monitoring.mjs';
import {setupRoot} from '../application/owner.mjs';

const execute = promisify(execFile);

export async function localProcessExample(env, operation, key) {
  const root = path.join(setupRoot(env), 'local-process-example');
  const args = ['-I', '-B', path.resolve('profiles/process-example/manage.py'), root, operation];
  if (key) args.push(key);
  try {
    const run = async () => {
      const {stdout} = await execute(env.ZENITH_SETUP_PYTHON || env.ZENITH_PROCESS_PYTHON || 'python3.12', args, {
      timeout: 360000, maxBuffer: 4 * 1024 * 1024,
      env: {PATH:env.PATH, HOME:env.HOME, LANG:'en_US.UTF-8', PIP_CONFIG_FILE:'/dev/null',
            ...(env.ZENITH_PROCESS_BUNDLE ? {ZENITH_PROCESS_BUNDLE:env.ZENITH_PROCESS_BUNDLE} : {})}
    });
      return JSON.parse(stdout);
    };
    if (operation === 'verify') return await serviceMonitor(env,'Local process example')('Verify Case, Frank effect and Runtime receipt',run);
    return await run();
  } catch (error) {
    const message = error.code === 'ENOENT' ? 'Run Hub with npm run setup to select Python 3.12.' :
      error.stderr?.trim().split('\n').at(-1)?.slice(0,400) || 'The local example operation was interrupted. Reopen its retained action.';
    throw Object.assign(Error(message), {code:message, status:409});
  }
}
