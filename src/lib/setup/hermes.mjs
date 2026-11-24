import {
  bootstrapPlan,
  bootstrapRelease,
  ensureBootstrap,
} from "./hermes-bootstrap.mjs";
import {
  pythonPreflight,
  verifyExecutable,
  diskPreflight,
} from "./preflight.mjs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { check, digest } from "./catalog.mjs";
import { atomic, readPrivate } from "./state.mjs";
import { endpoint } from "./network.mjs";
export function hermesAdapter({
  env,
  run,
  python,
  instanceScript,
  setupRoot,
  modelManager,
}) {
  const manifestFile = path.join(
      process.cwd(),
      "profiles/setup/hermes-installer.json",
    ),
    inventoryFile = path.join(
      process.cwd(),
      "profiles/setup/hermes-source.json.gz",
    );
  return {
    async prepare(item) {
      const bytes = await readFile(manifestFile),
        manifest = JSON.parse(bytes);
      const pin = item.descriptor.artifacts.find((a) => a.group === "hermes");
      check(
        pin,
        pin && digest(bytes) === pin.manifestSha256,
        "hermes_installer_pin_mismatch",
      );
      check(
        manifest,
        digest(await readFile(inventoryFile)) ===
          manifest.source.inventorySha256,
        "hermes_source_pin_mismatch",
      );
      const bootstrap = env.ZENITH_SETUP_PYTHON
          ? await pythonPreflight(python, run)
          : {
              bootstrap: bootstrapPlan(setupRoot, await bootstrapRelease()),
              prerequisites: [],
            },
        disk = await diskPreflight(
          setupRoot || env.ZENITH_HUB_SETUP_DIR || process.cwd(),
          1536,
        );
      return {
        artifacts: [],
        ...bootstrap,
        prerequisites: [
          ...bootstrap.prerequisites,
          ...disk.prerequisites,
          ...(process.platform === "darwin" && process.arch === "arm64"
            ? []
            : [
                "The pinned Hermes runtime currently supports Apple silicon macOS.",
              ]),
        ],
        effects: [
          "Install the exact Hermes source and its Python " +
            manifest.tools.python.version +
            " / uv " +
            manifest.tools.uv.version +
            " runtime in this instance.",
          "Resolve Python packages only from Hermes frozen uv.lock. Browser, computer-use tools and model downloads are not selected.",
          "No existing Hermes profile, credentials or conversations are adopted.",
        ],
        runtimePins: {
          bootstrapPython: python,
          sourceMode: env.ZENITH_SETUP_HERMES_SOURCE_CACHE
            ? "verified owner artifact cache"
            : "download pinned source",
          runtimeMode: env.ZENITH_SETUP_HERMES_TOOL_CACHE
            ? "verified owner public runtime cache"
            : "download pinned runtimes",
          source: manifest.source,
          tools: Object.fromEntries(
            Object.entries(manifest.tools).map(([k, v]) => [
              k,
              { version: v.version, url: v.url, sha256: v.sha256 },
            ]),
          ),
        },
      };
    },
    async install(plan) {
      if (plan.bootstrap.kind === "managed") {
        await ensureBootstrap(plan.bootstrap, await bootstrapRelease(), run);
      }
      await verifyExecutable(plan.bootstrap);
      const args = [
        "-I",
        "-B",
        path.join(process.cwd(), "scripts/setup/hermes-install.py"),
        "--plan",
        plan.planFile,
        "--manifest",
        manifestFile,
        "--inventory",
        inventoryFile,
      ];
      if (env.ZENITH_SETUP_HERMES_SOURCE_CACHE)
        args.push("--source-cache", env.ZENITH_SETUP_HERMES_SOURCE_CACHE);
      if (env.ZENITH_SETUP_HERMES_TOOL_CACHE)
        args.push("--tool-cache", env.ZENITH_SETUP_HERMES_TOOL_CACHE);
      return run(plan.bootstrap.executable, args, {
        timeout: 960000,
        logFile: path.join(
          path.dirname(path.dirname(plan.planFile)),
          "logs",
          path.basename(plan.planFile) + ".log",
        ),
      });
    },
    async lifecyclePython(plan) {
      const receipt = JSON.parse(
        await readPrivate(path.join(plan.root, "receipt.json")),
      );
      if (receipt.software) {
        const { verifySoftware } = await import("./hermes-installations.mjs");
        await verifySoftware(receipt.software, { full: false });
        return receipt.software.python;
      }
      const manifest = JSON.parse(await readFile(manifestFile));
      const directory = path.join(
        plan.root,
        "tools",
        manifest.tools.python.directory,
      );
      const executable = path.join(directory, "bin/python3.14");
      const vendor = await bootstrapRelease();
      const accepted = [
        manifest.tools.python.cacheInventory.find(
          (f) => f.path === "bin/python3.14",
        ).sha256,
        vendor.tools.python.cacheInventory.find(
          (f) => f.path === "bin/python3.14",
        ).sha256,
      ];
      check(
        executable,
        accepted.includes(digest(await readFile(executable))),
        "hermes_runtime_integrity_mismatch",
      );
      return executable;
    },
    async configure(plan) {
      const root = plan.root,
        receipt = JSON.parse(
          await readPrivate(path.join(root, "receipt.json")),
        );
      check(
        receipt,
        receipt.componentId === "hermes",
        "wrong_component_receipt",
      );
      let secrets;
      try {
        secrets = JSON.parse(
          await readPrivate(path.join(root, "data/hub-secrets.json")),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        const { randomBytes } = await import("node:crypto");
        secrets = { API_SERVER_KEY: randomBytes(32).toString("hex") };
        await atomic(path.join(root, "data/hub-secrets.json"), secrets);
      }
      if (plan.config.modelEndpoint) {
        const modelOrigin = endpoint(plan.config.modelEndpoint);
        check(
          modelOrigin,
          plan.config.backendKind !== "local" ||
            modelOrigin.hostname === "127.0.0.1",
          "local_model_requires_loopback",
        );
      }
      if (plan.config.secretRef) {
        const map = JSON.parse(
          await readPrivate(env.ZENITH_SETUP_SECRETS_FILE),
        );
        check(
          map,
          typeof map[plan.config.secretRef] === "string",
          "model_secret_reference_unavailable",
        );
        secrets.HUB_MODEL_API_KEY = (
          await readPrivate(map[plan.config.secretRef], 4096)
        ).trim();
        await atomic(path.join(root, "data/hub-secrets.json"), secrets);
      }
      if (
        plan.config.providerId &&
        !plan.config.secretRef &&
        secrets.HUB_MODEL_API_KEY
      ) {
        delete secrets.HUB_MODEL_API_KEY;
        await atomic(path.join(root, "data/hub-secrets.json"), secrets);
      }
      check(modelManager, !!modelManager, "native_model_manager_required");
      // Merge API settings through native Hermes config; never replace the default
      // configuration or erase existing provider credentials/history/settings.
      await modelManager.configureAPI({ ...plan, componentId: "hermes", mode: "install" });
      if (plan.config.modelName) {
        await modelManager.applyBackend({ ...plan, componentId: "hermes", mode: "install", config: { ...plan.config, providerId: plan.config.providerId || "custom" } });
      }
      await atomic(path.join(root, "config/selection.json"), plan.config);
      await atomic(path.join(root, "receipt.json"), {
        ...receipt,
        ...(!receipt.profile ? { configurationHome: receipt.configurationHome || path.join(root, "data") } : {}),
        configured: true,
        backendConfigured: !!(
          plan.config.modelEndpoint ||
          (plan.config.providerId && plan.config.modelName)
        ),
      });
      // The copied fixed lifecycle wrapper owns this instance, not Hermes global service commands.
      const { copyFile } = await import("node:fs/promises");
      await copyFile(instanceScript, path.join(root, "controller.py"));
      const next = JSON.parse(
        await readPrivate(path.join(root, "receipt.json")),
      );
      await atomic(path.join(root, "receipt.json"), {
        ...next,
        controllerSha256: digest(await readFile(instanceScript)),
      });
    },
    async token(item) {
      return JSON.parse(
        await readPrivate(path.join(item.root, "data/hub-secrets.json")),
      ).API_SERVER_KEY;
    },
  };
}
