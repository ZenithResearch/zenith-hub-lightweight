import {Worker} from 'node:worker_threads';
import {reject} from './registry.mjs';
let active = 0;
export async function processDataset(operation, input, registry) {
  if (active >= 2) reject('object_store_busy', 409);
  active++;
  try {
    return await new Promise((resolve, rejectPromise) => {
      const worker = new Worker(new URL('./codec-worker.mjs', import.meta.url), {
        execArgv: [],
        workerData: {operation, ...input, documents: registry?.documents || {}},
        resourceLimits: {maxOldGenerationSizeMb: 128, stackSizeMb: 4},
      });
      let settled = false;
      function finish(error, value) {
        if (settled) return;
        settled = true; clearTimeout(timer); void worker.terminate();
        if (error) rejectPromise(error); else resolve(value);
      }
      const timer = setTimeout(() => {
        try {reject('jsonld_processing_limit', 422);} catch (error) {finish(error);}
      }, 15000);
      worker.on('message', message => {
        if (message.ok) finish(null, message.result);
        else {try {reject(message.code);} catch (error) {finish(error);}}
      });
      worker.on('error', () => {try {reject('jsonld_processing_failed');} catch (error) {finish(error);}});
      worker.on('exit', code => {if (!settled) {try {reject('jsonld_processing_failed');} catch (error) {finish(error);}}});
    });
  } finally {active--;}
}
