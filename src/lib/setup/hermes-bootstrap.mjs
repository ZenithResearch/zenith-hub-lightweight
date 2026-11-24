import { gunzipSync } from "node:zlib";
/** Release-pinned bootstrap: no Homebrew, shell installer or existing Python profile. */
import path from "node:path";
import {
  open,
  readFile,
  realpath,
  rename,
  lstat,
  readdir,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { check, digest } from "./catalog.mjs";
import { privateDirectory, atomic, readPrivate } from "./state.mjs";
export async function bootstrapRelease() {
  const directory = path.join(process.cwd(), "profiles/setup");
  const pin = JSON.parse(
    await readFile(path.join(directory, "hermes-bootstrap.json")),
  );
  const inventory = await readFile(
    path.join(directory, "hermes-bootstrap-files.json.gz"),
  );
  check(
    pin,
    digest(inventory) === pin.inventorySha256,
    "bootstrap_inventory_changed",
  );
  return {
    tools: {
      python: {
        ...pin,
        cacheInventory: JSON.parse(gunzipSync(inventory)).files,
      },
    },
  };
}
export function bootstrapPlan(root, manifest) {
  const tool = manifest.tools.python;
  const directory = path.join(root, "cache", "bootstrap", tool.sha256);
  return {
    kind: "managed",
    executable: path.join(directory, "bin/python3.14"),
    version: tool.version,
    sha256: tool.cacheInventory.find((f) => f.path === "bin/python3.14").sha256,
    directory,
    artifactSha256: tool.sha256,
    url: tool.url,
  };
}
export async function verifyRuntime(directory, tool) {
  for (const f of tool.cacheInventory) {
    const target = path.join(directory, f.path),
      stat = await lstat(target);
    check(
      stat,
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        digest(await readFile(target)) === f.sha256,
      "bootstrap_integrity_mismatch",
    );
  }
  const visit = async (at) => {
    for (const row of await readdir(at, { withFileTypes: true })) {
      const file = path.join(at, row.name);
      if (row.isSymbolicLink())
        check(
          row,
          (await realpath(file)).startsWith(directory + path.sep),
          "bootstrap_external_symlink",
        );
      else if (row.isDirectory()) await visit(file);
    }
  };
  await visit(directory);
}
export async function ensureBootstrap(
  pin,
  manifest,
  run,
  { fetcher = fetch } = {},
) {
  check(
    pin,
    pin.kind === "managed" &&
      pin.artifactSha256 === manifest.tools.python.sha256 &&
      pin.url === manifest.tools.python.url,
    "bootstrap_pin_changed",
  );
  const parent = path.dirname(pin.directory);
  await privateDirectory(parent);
  try {
    const receipt = JSON.parse(
      await readPrivate(path.join(pin.directory, "hub-bootstrap.json")),
    );
    check(
      receipt,
      receipt.artifactSha256 === pin.artifactSha256,
      "bootstrap_pin_changed",
    );
    await verifyRuntime(pin.directory, manifest.tools.python);
    return pin;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const staging = pin.directory + ".pending-" + randomUUID();
  await privateDirectory(staging);
  const archive = staging + ".tar.gz",
    out = await open(archive, "wx", 0o600);
  try {
    let url = pin.url,
      response;
    for (let redirects = 0; redirects < 6; redirects++) {
      const u = new URL(url);
      check(
        u,
        u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          [
            "github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
          ].includes(u.hostname),
        "invalid_bootstrap_url",
      );
      response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(120000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        url = new URL(response.headers.get("location"), url).href;
        await response.body?.cancel();
        continue;
      }
      break;
    }
    check(response, response?.ok && response.body, "bootstrap_download_failed");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      check(bytes, bytes <= 512 * 1024 ** 2, "bootstrap_archive_too_large");
      await out.write(chunk);
    }
    await out.sync();
  } finally {
    await out.close();
  }
  check(
    pin,
    digest(await readFile(archive)) === pin.artifactSha256,
    "bootstrap_archive_changed",
  );
  // Extraction is permitted only after matching the release-owned vendor archive digest.
  await run(
    "/usr/bin/tar",
    ["-xzf", archive, "--strip-components=1", "-C", staging],
    { timeout: 60000 },
  );
  await verifyRuntime(staging, manifest.tools.python);
  await atomic(path.join(staging, "hub-bootstrap.json"), {
    artifactSha256: pin.artifactSha256,
    version: pin.version,
  });
  await rename(staging, pin.directory);
  return pin;
}
