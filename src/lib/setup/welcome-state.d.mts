export function welcomeState(snapshot: any, targetId?: string): {phase: string; instance?: any; operation?: any; instances: any[]};

export function welcomeLandingState(snapshot:any,state?:ReturnType<typeof welcomeState>): {state:"checking"|"recover"|"configure"|"install";label:string;installed:boolean;status:string};
