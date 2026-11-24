/** Read-only discovery of installed software. Profiles never imply software absence. */
import os from "node:os";
import path from "node:path";
import { readFile, lstat, realpath, readdir, access } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { bootstrapRelease } from "./hermes-bootstrap.mjs";
import { check, digest } from "./catalog.mjs";
import { readPrivate, privateDirectory, atomic } from "./state.mjs";

const safeRead = async (p, max = 1048576) => {
  const s = await lstat(p);
  check(
    s,
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.size <= max &&
      s.uid === process.getuid(),
    "unsafe_hermes_installation_file",
  );
  return readFile(p, "utf8");
};
const json = async (p) => JSON.parse(await safeRead(p));
const exists = async (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const expand = (s, home) => s.replaceAll("$HOME", home).replace(/^~/, home);
export function hermesInstallations({
  env = process.env,
  setupRoot,
  run,
  verifier = verifySoftware,
} = {}) {
  let cached, pending;
  async function discover({ fresh = false } = {}) {
    if (!fresh && cached && Date.now() - cached.at < 30000) return cached.rows;
    if (pending) return pending;
    pending = scan()
      .then((rows) => {
        cached = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  async function scan() {
    const home = env.HOME || os.homedir(),
      sourceHomes = new Map(),
      launchers = [];
    const add = (source, profileRoot, runtimeRoot, launcher) => {
      if (path.isAbsolute(source) && !sourceHomes.has(source))
        sourceHomes.set(source, { source, profileRoot, runtimeRoot, launcher });
    };
    for (const dir of new Set([
      path.join(home, ".local/bin"),
      ...(env.PATH || "").split(path.delimiter).filter(Boolean),
    ])) {
      const launcher = path.join(dir, "hermes");
      try {
        const actual = await realpath(launcher),
          text = await safeRead(actual, 131072);
        launchers.push({ path: launcher, actual });
        const profileRoot = expand(
          text.match(/HERMES_HOME=.*?:-([^}\n]+)}/)?.[1] ||
            env.HERMES_HOME ||
            path.join(home, ".hermes"),
          home,
        );
        const runtimeRoot = text.match(
          /HERMES_RUNTIME_DIR=["']?([^\n"' ]+)/,
        )?.[1];
        for (const match of text.matchAll(
          /(?:exec\s+|["'])(\/[^\n"' ]+)\/\.hermes\/bin\/hermes/g,
        ))
          add(match[1], profileRoot, runtimeRoot, launcher);
        for (const candidate of [
          path.dirname(path.dirname(actual)),
          path.dirname(path.dirname(path.dirname(actual))),
        ])
          if (await exists(path.join(candidate, "install-stamp.json")))
            add(candidate, profileRoot, runtimeRoot, launcher);
      } catch {}
    }
    const roots = new Set(
      [env.HERMES_HOME, path.join(home, ".hermes")].filter(Boolean),
    );
    for (const root of roots)
      add(
        path.join(root, "hermes-agent"),
        root,
        path.join(root, "tools"),
        launchers[0]?.path,
      );
    if (env.ZENITH_HERMES_SOURCE_DIR)
      add(
        env.ZENITH_HERMES_SOURCE_DIR,
        env.HERMES_HOME || path.join(home, ".hermes"),
        env.ZENITH_HERMES_RUNTIME_DIR,
        launchers[0]?.path,
      );
    const manifest = JSON.parse(
        await readFile("profiles/setup/hermes-installer.json", "utf8"),
      ),
      rows = [];
    for (const c of sourceHomes.values()) {
      try {
        const source = await realpath(c.source),
          stamp = await json(path.join(source, "install-stamp.json"));
        if (!(await exists(path.join(source, "hermes_cli/main.py")))) continue;
        const key = digest(source).slice(0, 16),
          runtimeRoot = c.runtimeRoot || path.join(c.profileRoot, "tools");
        let environment;
        for (const owner of [
          c.profileRoot,
          path.dirname(source),
          path.join(home, ".hermes"),
        ]) {
          try {
            const fact = await json(
              path.join(owner, "installs", key, "facts.json"),
            );
            const value = fact.packages?.venv?.environment;
            if (
              path.isAbsolute(value || "") &&
              (await exists(path.join(value, "bin/python")))
            ) {
              environment = value;
              break;
            }
          } catch {}
        }
        for (const name of [".venv", "venv", "environment"])
          if (
            !environment &&
            (await exists(path.join(source, name, "bin/python")))
          )
            environment = path.join(source, name);
        const runtimePython = path.join(
          runtimeRoot,
          manifest.tools.python.directory,
          "bin/python3.14",
        );
        const supported =
          stamp.commit === manifest.source.commit &&
          !!environment &&
          (await exists(runtimePython));
        const profiles = [];
        if (
          (await exists(path.join(c.profileRoot, "config.yaml"))) ||
          (await exists(path.join(c.profileRoot, ".env")))
        )
          profiles.push({
            id: digest(c.profileRoot),
            name: "Default",
            home: c.profileRoot,
          });
        try {
          for (const entry of (
            await readdir(path.join(c.profileRoot, "profiles"), {
              withFileTypes: true,
            })
          ).slice(0, 64)) {
            if (
              !entry.isDirectory() ||
              !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)
            )
              continue;
            const p = path.join(c.profileRoot, "profiles", entry.name);
            if (await exists(path.join(p, "config.yaml")))
              profiles.push({ id: digest(p), name: entry.name, home: p });
          }
        } catch {}
        rows.push({
          id: digest(source),
          source,
          commit: stamp.commit,
          launcher: c.launcher,
          profileRoot: c.profileRoot,
          profiles,
          software: { source, environment, runtimeRoot, python: runtimePython },
          compatible: supported,
          reason: supported
            ? null
            : "This installed revision or runtime is not yet supported by the Hub adapter.",
        });
      } catch {}
    }
    if (!rows.length && launchers.length)
      rows.push({
        id: digest(launchers[0].actual),
        launcher: launchers[0].path,
        compatible: false,
        profiles: [],
        reason:
          "Hermes is installed, but its source/runtime location could not be verified. Select a supported installation before configuring the guide.",
      });
    return rows;
  }
  async function inspect(id, templateId) {
    const rows = await discover({ fresh: true }),
      found = rows.find((r) => r.id === id);
    check(found, found?.compatible, "unsupported_hermes_installation");
    await verifier(found.software, { contractOnly: true });
    const template = templateId
      ? found.profiles.find((p) => p.id === templateId)
      : null;
    check(template, !templateId || template, "unknown_hermes_profile");
    return {
      software: found.software,
      sourceCommit: found.commit,
      template: template ? { home: template.home, name: template.name } : null,
      configurationHome: found.profileRoot,
    };
  }
  return {
    discover,
    async public() {
      return (await discover()).map(
        ({ id, source, commit, launcher, compatible, reason, profiles }) => ({
          id,
          source,
          commit,
          launcher,
          compatible,
          reason,
          profiles: profiles.map(({ id, name }) => ({ id, name })),
        }),
      );
    },
    inspect,
    async prepare(item, { installationId, templateId, existing, defaultConfiguration = false } = {}) {
      let binding;
      if (existing) {
        const receipt = JSON.parse(
          await readPrivate(
            path.join(setupRoot, "instances", item.instanceId, "receipt.json"),
          ),
        );
        const base = path.join(setupRoot, "instances", item.instanceId);
        binding = {
          software: receipt.software || {
            source: path.join(base, "source"),
            environment: path.join(base, receipt.environment),
            runtimeRoot: path.join(base, "tools"),
            python: path.join(
              base,
              "tools",
              JSON.parse(
                await readFile("profiles/setup/hermes-installer.json", "utf8"),
              ).tools.python.directory,
              "bin/python3.14",
            ),
          },
          sourceCommit: receipt.source.commit,
          configurationHome: receipt.configurationHome || receipt.profile?.home || path.join(base, "data"),
          template: null,
        };
        await verifier(binding.software, { contractOnly: true });
      } else binding = await inspect(installationId, templateId);
      if (defaultConfiguration) {
        check(templateId, !templateId, "default_configuration_has_no_template");
        const home = await realpath(binding.configurationHome), stat = await lstat(home);
        check(stat, stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "hermes_configuration_not_private");
        return {
          guideBinding: { ...binding, template: null, configurationHome: home, configurationIdentity: {dev: stat.dev, ino: stat.ino}, defaultConfiguration: true },
          artifacts: [], prerequisites: [],
          effects: ["Reuse the installed Hermes software and its default configuration at " + home + ".", "No named profile is created or selected. Provider configuration follows; existing credentials, history and unrelated settings stay in place."]
        };
      }
      return {
        guideBinding: binding,
        artifacts: [],
        prerequisites: [],
        effects: [
          "Reuse the installed Hermes software; no source download or reinstall.",
          "Create a dedicated hub-guide profile for this Hub with its own credentials, history and private API.",
          ...(binding.template
            ? [
                "Use only the model selection from " +
                  binding.template.name +
                  ". Sign in separately for the guide; credentials and history are not copied.",
              ]
            : []),
        ],
      };
    },
    async create(plan) {
      const binding = plan.guideBinding;
      await verifier(binding.software, { contractOnly: true });
      await privateDirectory(plan.root);
      for (const d of ["home", "cache", "logs", "config", "data"])
        await privateDirectory(path.join(plan.root, d));
      const receiptFile = path.join(plan.root, "receipt.json");
      let prior = {};
      try {
        prior = JSON.parse(await readPrivate(receiptFile));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      check(prior, !prior.profile, "guide_profile_already_exists");
      let configurationHome;
      if (binding.defaultConfiguration) {
        configurationHome = await realpath(binding.configurationHome);
        const stat = await lstat(configurationHome);
        check(stat, configurationHome === binding.configurationHome && stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.dev === binding.configurationIdentity.dev && stat.ino === binding.configurationIdentity.ino, "hermes_configuration_changed");
      }
      await atomic(receiptFile, {
        ...prior,
        schema: "zenith.hub-component-receipt.v1",
        componentId: "hermes",
        instanceId: plan.instanceId,
        installed: true,
        configured: false,
        backendConfigured: false,
        source: {
          repository: "NousResearch/hermes-agent",
          commit: binding.sourceCommit,
        },
        software: binding.software,
        ...(configurationHome ? { configurationHome } : {}),
        planDigest: plan.digest,
      });
      if (configurationHome) return { configurationHome, backend: {} };
      const output = await run(
        binding.software.environment + "/bin/python",
        [
          "-I",
          "-B",
          path.join(process.cwd(), "scripts/setup/hermes-profile.py"),
          "--root",
          plan.root,
          "--plan",
          plan.planFile,
        ],
        { timeout: 90000, logFile: path.join(plan.root, "logs/profile.log") },
      );
      return JSON.parse(output);
    },
  };
}
export async function verifySoftware(
  software,
  { full = true, contractOnly = false } = {},
) {
  check(
    software,
    software &&
      ["source", "environment", "runtimeRoot", "python"].every(
        (k) => typeof software[k] === "string" && path.isAbsolute(software[k]),
      ),
    "invalid_hermes_software_binding",
  );
  const manifest = JSON.parse(
    await readFile("profiles/setup/hermes-installer.json", "utf8"),
  );
  const bytes = await readFile("profiles/setup/hermes-source.json.gz");
  check(
    bytes,
    digest(bytes) === manifest.source.inventorySha256,
    "hermes_source_pin_mismatch",
  );
  const contractFiles = new Set([
    "hermes_constants.py",
    "hermes_bootstrap.py",
    "pyproject.toml",
    "uv.lock",
    "hermes_cli/profiles.py",
    "hermes_cli/profiles_initialization.py",
    "hermes_cli/config.py",
    "hermes_cli/web_server.py",
    "hermes_cli/provider_catalog.py",
    "hermes_cli/web_routers/config_env.py",
    "hermes_cli/web_routers/models.py",
    "hermes_cli/web_routers/oauth.py",
    "hermes_cli/web_routers/local_models.py",
    "gateway/platforms/api_server.py",
    "gateway/run.py",
    "pm/runtime.py",
  ]);
  const allFiles = JSON.parse(gunzipSync(bytes)).files;
  const inventory = contractOnly
    ? allFiles.filter((f) => contractFiles.has(f.path))
    : allFiles;
  check(
    inventory,
    !contractOnly || inventory.length === contractFiles.size,
    "missing_hermes_contract_pin",
  );
  let index = 0;
  if (!full) {
    const stamp = JSON.parse(
      await readFile(path.join(software.source, "install-stamp.json"), "utf8"),
    );
    check(
      stamp,
      stamp.commit === manifest.source.commit,
      "hermes_installed_source_changed",
    );
  }
  if (full)
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        while (index < inventory.length) {
          const f = inventory[index++],
            p = path.join(software.source, f.path),
            s = await lstat(p);
          check(
            s,
            s.isFile() &&
              !s.isSymbolicLink() &&
              digest(await readFile(p)) === f.sha256,
            "hermes_installed_source_changed",
          );
        }
      }),
    );
  const accepted = [
    manifest.tools.python.cacheInventory.find(
      (f) => f.path === "bin/python3.14",
    ).sha256,
  ];
  const vendor = await bootstrapRelease();
  accepted.push(
    vendor.tools.python.cacheInventory.find((f) => f.path === "bin/python3.14")
      .sha256,
  );
  check(
    software,
    accepted.includes(digest(await readFile(software.python))) &&
      (await exists(path.join(software.environment, "pyvenv.cfg"))),
    "hermes_installed_runtime_changed",
  );
}
