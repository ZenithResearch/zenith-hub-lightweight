export type CommunicationInstance = { instanceId?: string; componentId: string; mode: string; config?: { endpoint?: string; port?: number }; partial?: boolean; installed?: boolean | null; running?: boolean | null; stale?: boolean; observation?: { observedAt?: string; reachable?: boolean | null; permission?: string } };
export type CommunicationCandidate = { componentId: string; endpoint: string; observation?: CommunicationInstance["observation"] };
export type CommunicationRow = { id: string; componentId: string; instanceId?: string; endpoint: string; name: string; status: string; detail?: string; action?: "choose" | "manage" };
export function serviceEndpoint(item: CommunicationInstance): string | null;
export function communicationRows(instances: CommunicationInstance[], candidates: CommunicationCandidate[] | null, selection: CommunicationInstance[], options?: { stale?: boolean; now?: number; labels?: Record<string, string> }): CommunicationRow[];
