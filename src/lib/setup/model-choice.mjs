/** Catalog suggestions edit a draft only; they never activate a backend. */
const provider = (choice) => choice.providerId || "custom";
export function modelChoiceKey(instanceId, choice) {
  return JSON.stringify([instanceId, provider(choice), provider(choice) === "custom" ? choice.modelEndpoint || "" : "", provider(choice) === "custom" ? choice.secretRef || "" : ""]);
}
export function withSuggestedModel(current, requested, catalog) {
  if (modelChoiceKey("", current) !== modelChoiceKey("", requested) || current.modelName?.trim()) return current;
  const available = new Set(catalog.models || []);
  const modelName = [catalog.currentModel, catalog.recommendedModel].find((m) => typeof m === "string" && m && available.has(m));
  return modelName ? { ...current, modelName } : current;
}

/** Seed an untouched Configure form from the native default slot, never from a named template. */
export function withDefaultConfiguration(current, configuration) {
  if (current.providerId || current.modelName || current.modelEndpoint || !configuration?.modelName) return current;
  const next = { providerId: configuration.providerId || "custom", modelName: configuration.modelName };
  if (next.providerId === "custom" && configuration.modelEndpoint) {
    // Native config stores an API base; the Hub connection contract stores its origin.
    next.modelEndpoint = configuration.modelEndpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    if (configuration.contextLength) next.contextLength = configuration.contextLength;
  }
  return next;
}
