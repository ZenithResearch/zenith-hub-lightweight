export type ModelChoice = { providerId?: string; modelEndpoint?: string; modelName?: string };
export type ModelCatalog = { models: string[]; recommendedModel?: string; currentModel?: string };
export function modelChoiceKey(instanceId: string, choice: ModelChoice): string;
export function withSuggestedModel<T extends ModelChoice>(current: T, requested: ModelChoice, catalog: ModelCatalog): T & { modelName?: string };

export function withDefaultConfiguration(current: any, configuration: any): any;
