import { readFile, realpath, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { check, digest } from "./catalog.mjs";
import { readPrivate, privateDirectory } from "./state.mjs";
import {
  pythonPreflight,
  verifyExecutable,
  diskPreflight,
} from "./preflight.mjs";
export function matrixAdapter({ root, env, run, python }) {
  const manifestFile = path.join(
    process.cwd(),
    "profiles/setup/matrix-build.json",
  );
  async function recipe(item) {
    const raw = await readFile(manifestFile),
      manifest = JSON.parse(raw),
      pin = item.descriptor.artifacts.find((a) => a.group === "matrix");
    check(pin, pin?.preparationSha256 === digest(raw), "matrix_recipe_changed");
    return { manifest, recipeSha256: digest(raw) };
  }
  async function prepared(item) {
    const r = await recipe(item),
      directory = path.join(root, "cache/matrix", r.recipeSha256);
    try {
      const receipt = JSON.parse(
        await readPrivate(path.join(directory, "receipt.json")),
      );
      check(
        receipt,
        receipt.recipeSha256 === r.recipeSha256 && receipt.state === "prepared",
        "matrix_preparation_incomplete",
      );
      for (const f of receipt.artifacts)
        check(
          f,
          path.basename(f.filename) === f.filename &&
            digest(
              await readFile(path.join(directory, "wheels", f.filename)),
            ) === f.sha256,
          "matrix_prepared_artifact_changed",
        );
      return { directory, receipt, ...r };
    } catch (e) {
      if (e.code === "ENOENT") return { directory, receipt: null, ...r };
      throw e;
    }
  }
  return {
    prepared,
    async prepare(item, action) {
      const base = await pythonPreflight(python, run),
        p = await prepared(item),
        prerequisites = [
          ...base.prerequisites,
          ...(process.platform === "darwin" && process.arch === "arm64"
            ? []
            : ["The pinned native Matrix build supports Apple silicon macOS."]),
        ];
      let retained = false;
      try {
        retained =
          JSON.parse(
            await readPrivate(path.join(p.directory, "operation.json")),
          ).state === "preparation-failed-retained";
      } catch {}
      const disk = await diskPreflight(
        p.directory,
        action === "prepare-artifacts" ? (retained ? 512 : 1024) : 384,
      );
      prerequisites.push(...disk.prerequisites);
      const effects =
        action === "prepare-artifacts"
          ? [
              "Download 58 exact PyPI runtime wheels and the hash-pinned Synapse 1.165.0 source archive.",
              "Build Synapse using pinned maturin 1.16.0 and Cargo.lock checksums in a private build environment. No service is installed or started.",
              "Retain verified downloads, compiler provenance, progress and an output-hash receipt for explicit retry.",
            ]
          : [
              "Install only the prepared, verified Matrix wheel closure. Configure and start remain separate reviews.",
            ];
      let compiler = null;
      if (action === "prepare-artifacts") {
        try {
          const rustc =
            env.ZENITH_SETUP_RUSTC ||
            path.join(os.homedir(), ".cargo/bin/rustc");
          const sysroot = (
            await run(rustc, ["--print", "sysroot"], { timeout: 10000 })
          ).trim();
          const cargo = await realpath(path.join(sysroot, "bin/cargo")),
            rust = await realpath(path.join(sysroot, "bin/rustc"));
          const clang = (
            await run("/usr/bin/xcrun", ["--find", "clang"], { timeout: 10000 })
          ).trim();
          await access(clang);
          const sdk = (
            await run(
              "/usr/bin/xcrun",
              ["--sdk", "macosx", "--show-sdk-path"],
              { timeout: 10000 },
            )
          ).trim();
          await access(path.join(sdk, "usr/include/TargetConditionals.h"));
          const sdkSettingsSha256 = digest(
            await readFile(path.join(sdk, "SDKSettings.json")),
          );
          compiler = {
            sdk: { path: sdk, settingsSha256: sdkSettingsSha256 },
            cargo: {
              executable: cargo,
              sha256: digest(await readFile(cargo)),
              version: (
                await run(cargo, ["--version"], { timeout: 10000 })
              ).trim(),
            },
            rustc: {
              executable: rust,
              sha256: digest(await readFile(rust)),
              version: (
                await run(rust, ["--version"], { timeout: 10000 })
              ).trim(),
            },
            clang: { executable: clang, sha256: digest(await readFile(clang)) },
          };
        } catch {
          prerequisites.push(
            "Install the Rust stable toolchain and Apple Command Line Tools, then restart this preview. Matrix native builds require rustc, cargo and clang; Hub does not install system developer tools.",
          );
        }
      } else if (!p.receipt)
        prerequisites.push(
          "Prepare Matrix artifacts first using “Review Matrix artifact preparation”. No cache is required before that reviewed action.",
        );
      if (action !== "prepare-artifacts" && item.config.access !== "private")
        prerequisites.push(
          "Public TLS and DNS delegation must be configured and verified before public access.",
        );
      if (
        action !== "prepare-artifacts" &&
        item.config.domainMode === "managed"
      )
        prerequisites.push(
          "Managed Zenith subdomain reservation must be supplied by the domain operator.",
        );
      return {
        artifacts: p.receipt
          ? p.receipt.artifacts.map((f) => ({
              ...f,
              path: path.join(p.directory, "wheels", f.filename),
            }))
          : [],
        prerequisites,
        effects,
        bootstrap: base.bootstrap,
        compiler,
        preparation: {
          directory: p.directory,
          recipeSha256: p.recipeSha256,
          ready: !!p.receipt,
          requiredMiB: disk.requiredMiB,
        },
        runtimePins: {
          source: p.manifest.source,
          build: p.manifest.build,
          downloads: p.manifest.wheels.map(
            ({ filename, url, sha256, bytes }) => ({
              filename,
              url,
              sha256,
              bytes,
            }),
          ),
          compiler,
          storage: disk,
        },
        progressFile: path.join(p.directory, "operation.json"),
      };
    },
    async execute(plan) {
      await privateDirectory(plan.preparation.directory);
      await verifyExecutable(plan.bootstrap);
      for (const pin of Object.values(plan.compiler || {}))
        if (pin.executable) await verifyExecutable(pin);
      check(
        plan,
        digest(
          await readFile(path.join(plan.compiler.sdk.path, "SDKSettings.json")),
        ) === plan.compiler.sdk.settingsSha256,
        "matrix_sdk_changed",
      );
      return run(
        plan.bootstrap.executable,
        [
          "-I",
          "-B",
          path.join(process.cwd(), "scripts/setup/matrix-prepare.py"),
          "--plan",
          plan.planFile,
          "--manifest",
          manifestFile,
        ],
        {
          timeout: 1200000,
          logFile: path.join(
            root,
            "logs",
            path.basename(plan.planFile) + ".log",
          ),
        },
      );
    },
  };
}
