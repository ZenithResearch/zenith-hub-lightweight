/** Resolve installation layout only. Presence still requires pinned source/runtime inspection. */
import path from "node:path";
import {readFile} from "node:fs/promises";
import {check} from "./catalog.mjs";

export async function softwareFromHermesReceipt(root, receipt) {
  check(root, path.isAbsolute(root), "invalid_hermes_instance_root");
  check(receipt, receipt?.componentId === "hermes" && receipt.installed === true, "hermes_not_installed");
  if (receipt.software) {
    const fields = ["source", "environment", "runtimeRoot", "python"];
    check(receipt, fields.every(k => typeof receipt.software[k] === "string" && path.isAbsolute(receipt.software[k]) && !receipt.software[k].includes("\0")), "invalid_hermes_software_binding");
    return Object.fromEntries(fields.map(k => [k, receipt.software[k]]));
  }
  // The official source installer owns a relative environment generation. No
  // named profile, configured backend, global launcher or running API is needed.
  check(receipt, /^environment-[a-f0-9]{1,64}$/.test(receipt.environment || ""), "invalid_hermes_environment");
  const manifest = JSON.parse(await readFile("profiles/setup/hermes-installer.json", "utf8"));
  return {
    source: path.join(root, "source"),
    environment: path.join(root, receipt.environment),
    runtimeRoot: path.join(root, "tools"),
    python: path.join(root, "tools", manifest.tools.python.directory, "bin/python3.14"),
  };
}
