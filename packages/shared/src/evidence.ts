import type { Evidence } from './intelligence';
export const EVIDENCE_POLICY_VERSION = 'supported-evidence-v2';
export function qualificationSupport(item: {verified:boolean;evidenceIds:string[];conflictWith?:string[]|undefined}, evidence: ReadonlyMap<string,Evidence>) {
 const refs=item.evidenceIds.map(id=>evidence.get(id));
 const conflict=!!item.conflictWith?.length||refs.some(e=>e?.verified&&e.stance==='contradicts');
 const supported=refs.filter((e):e is Evidence=>!!e&&e.verified&&e.stance!=='contradicts'&&e.confidence*(e.sourceReliability??1)>0);
 const best=supported.map(e=>({e,score:e.confidence*(e.sourceReliability??1)})).sort((a,b)=>b.score-a.score||a.e.id.localeCompare(b.e.id))[0];
 return {verified:item.verified,conflict,confidence:item.verified&&!conflict?(best?.score??0):0,extractionConfidence:best?.e.confidence??0,sourceReliability:best?.e.sourceReliability??null,evidenceIds:supported.map(e=>e.id).sort()};
}
