import { realpath, readFile, access, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { digest, check } from "./catalog.mjs";
/** The installer bootstrap is distinct from Hermes' managed Python runtime. */
export async function pythonPreflight(python, run) {
  try {
    await access(python, constants.X_OK);
    const executable = await realpath(python);
    const value = JSON.parse(
      await run(
        executable,
        [
          "-I",
          "-S",
          "-c",
          'import json,sys; print(json.dumps({"version":list(sys.version_info[:3])}))',
        ],
        { timeout: 10000 },
      ),
    );
    check(
      value,
      value.version[0] === 3 && value.version[1] === 12,
      "unsupported_bootstrap_python",
    );
    return {
      prerequisites: [],
      bootstrap: {
        executable,
        version: value.version.join("."),
        sha256: digest(await readFile(executable)),
      },
    };
  } catch {
    return {
      prerequisites: [
        `Install Python 3.12, then set ZENITH_SETUP_PYTHON to its absolute executable path and restart this preview. Installer bootstrap unavailable at ${python}. Hermes manages its own Python separately.`,
      ],
      bootstrap: null,
    };
  }
}
export async function verifyExecutable(pin) {
  check(
    pin,
    pin && digest(await readFile(pin.executable)) === pin.sha256,
    "installer_executable_changed",
  );
}

export async function diskPreflight(destination, minMiB) {
  let at = destination;
  for (;;) {
    try {
      const s = await statfs(at);
      const availableMiB = Math.floor((s.bavail * s.bsize) / 1048576);
      return {
        availableMiB,
        requiredMiB: minMiB,
        prerequisites:
          availableMiB < minMiB
            ? [
                `Free at least ${minMiB} MiB on the installation volume before continuing (${availableMiB} MiB currently available). Existing data is preserved.`,
              ]
            : [],
      };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const { dirname } = await import("node:path");
      const next = dirname(at);
      if (next === at) throw e;
      at = next;
    }
  }
}
