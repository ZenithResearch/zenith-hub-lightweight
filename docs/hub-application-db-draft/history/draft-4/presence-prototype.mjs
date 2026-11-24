/** Pure synthetic policy prototype; not a production inspector and never reads files. */
export function classifyPresence({completeScope,candidates}) {
 if(candidates.some(c=>c.outcome==='verified'))return 'present';
 if(completeScope&&candidates.length>0&&candidates.every(c=>c.outcome==='not-found'))return 'absent';
 return 'unknown';
}
export function effectivePresence(proof,{bootId,wallNow,monotonicAgeMs,fingerprintMatches}) {
 const observed=Date.parse(proof.observedAt),until=Date.parse(proof.validUntil);
 if(proof.bootId!==bootId||!Number.isFinite(observed)||!Number.isFinite(until)||until-observed>30000||until<=observed||wallNow<observed-5000||wallNow>=until||monotonicAgeMs<0||monotonicAgeMs>=30000||!fingerprintMatches)return 'unknown';
 return proof.state;
}
