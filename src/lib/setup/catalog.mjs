/** Versioned, release-owned component capabilities. No browser-supplied executables. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {endpoint} from "./network.mjs";
import Ajv from "ajv/dist/2020.js";
export const digest = (value) =>
  createHash("sha256")
    .update(
      Buffer.isBuffer(value) || typeof value === "string"
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export function check(value, condition, code = "invalid_setup", status = 409) {
  if (!condition) throw Object.assign(new Error(code), { code, status });
  return value;
}
export function normalizeHermesBackend(value) {
  const config = { ...value };
  if (config.providerId && config.providerId !== "custom") {
    delete config.modelEndpoint;
    delete config.secretRef;
    delete config.modelFamily;
    if (config.providerId !== "llamacpp") delete config.contextLength;
  }
  if (config.providerId && config.providerId !== "llamacpp") delete config.localModelId;
  return config;
}
export async function loadCatalog(
  root = path.join(process.cwd(), "profiles/setup"),
) {
  const [raw, schema] = await Promise.all(
    ["catalog.json", "catalog.schema.json"].map((f) =>
      readFile(path.join(root, f), "utf8"),
    ),
  );
  const catalog = JSON.parse(raw),
    validate = new Ajv({ strict: true }).compile(JSON.parse(schema));
  check(catalog, validate(catalog), "invalid_component_catalog");
  const ids = new Set(catalog.components.map((c) => c.id));
  check(catalog, ids.size === catalog.components.length, "duplicate_component");
  for (const c of catalog.components)
    for (const requirement of c.serviceRequirements)
      check(catalog, ids.has(requirement), "missing_component_dependency");
  return {
    catalog,
    sha256: digest(raw),
    byId: new Map(catalog.components.map((c) => [c.id, c])),
  };
}
export function resolveSelection(registry, selection, { review = true, action } = {}) {
  check(
    selection,
    Array.isArray(selection) && selection.length <= 24,
    "invalid_selection",
  );
  const ids = new Set(),
    ports = new Set();
  return selection.map((item) => {
    check(
      item,
      item &&
        Object.keys(item).every((k) =>
          ["instanceId", "componentId", "mode", "config", "targetId", "recipeId"].includes(
            k,
          ),
        ),
      "invalid_selection",
    );
    check(
      item,
      typeof item.instanceId === "string" &&
        /^[a-z][a-z0-9-]{0,47}$/.test(item.instanceId) &&
        !ids.has(item.instanceId),
      "invalid_instance_identity",
    );
    ids.add(item.instanceId);
    const c = registry.byId.get(item.componentId);
    check(c, c, "unknown_component");
    check(item, c.modes.includes(item.mode), "unsupported_component_mode");
    let config = item.config || {};
    const validator = new Ajv({ strict: true }).compile(c.configurationSchema);
    const candidate = review
      ? config
      : Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ""));
    check(config, validator(candidate), "invalid_component_configuration");
    if (c.id === "hermes") config = normalizeHermesBackend(config);
    if (item.mode === "connect" && config.endpoint) config = {...config, endpoint:endpoint(config.endpoint).origin};
    if (review && item.mode === "connect")
      check(
        item,
        typeof config.endpoint === "string",
        "missing_existing_endpoint",
      );
    if (item.mode === "install" && config.port) {
      check(config, !ports.has(config.port), "selected_port_collision");
      ports.add(config.port);
    }
    if (review && c.id === "matrix" && item.mode !== "connect") {
      check(
        config,
        !!config.serverName && config.identityAcknowledged === true,
        "matrix_identity_review_required",
      );
      if (config.domainMode === "managed")
        check(
          config,
          config.serverName.endsWith(".zenith-research.ca"),
          "managed_domain_outside_namespace",
        );
      if (config.access === "private")
        check(
          config,
          config.federation !== true,
          "private_federation_conflict",
        );
    }
    return {
      ...structuredClone(item),
      config,
      descriptor: c,
      ...(action&&registry.resolveRecipe?{recipeRef:registry.resolveRecipe(item.componentId,item.mode,action,item.recipeId)}:{}),
      packageDependencies: c.packageDependencies,
      serviceRequirements: c.serviceRequirements.map((id) => ({
        componentId: id,
        satisfied: selection.some((s) => s.componentId === id),
        purpose:
          "Needed only for execution; installation does not start dependencies.",
      })),
    };
  });
}
