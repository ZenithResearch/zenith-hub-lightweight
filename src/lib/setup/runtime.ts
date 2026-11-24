import { after } from "next/server";
import { createSetupController } from "./controller.mjs";

// Next can load this module separately for different route bundles. Keep one
// process-local setup owner so CSRF tokens, pending work and busy state agree.
const cacheKey = Symbol.for("zenith.hub.setup.controllers");
const runtime = globalThis as unknown as Record<
  symbol,
  Map<string, ReturnType<typeof createSetupController>>
>;
const controllers = (runtime[cacheKey] ||= new Map());
const scope = JSON.stringify([
  process.env.ZENITH_OPERATOR_ORIGIN,
  process.env.ZENITH_HUB_SETUP_DIR,
  process.env.ZENITH_HUB_DATA_DIR,
  process.env.ZENITH_HUB_APPLICATION_DB,
  process.env.ZENITH_HUB_SERVER_INSTANCE,
]);
if (!controllers.has(scope)) {
  controllers.set(
    scope,
    createSetupController({
      defer: (fn: () => Promise<unknown>) => after(fn),
    }),
  );
}
export const setupController = controllers.get(scope)!;
