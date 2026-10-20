import type { CandidateProfile, Intelligence, ProfileFact } from '@rovdo/shared';
import { intelligenceOf, qualificationsConflict } from './candidate';
export function criticalReviewIds(profile:CandidateProfile|null,proposed:Intelligence,facts:ProfileFact[]=[]):Set<string>{
 const existing=profile?intelligenceOf(profile):null;const ids=new Set<string>();
 for(const key of ['skills','experience','education','projects','certifications'] as const)for(const q of proposed[key])if(q.conflictWith?.length||['experience','education','certifications'].includes(key)||existing?.[key].some(old=>old.verified&&qualificationsConflict(old,q)))ids.add(q.id);
 for(const f of facts)if(['experience','education','degree'].includes(f.field))ids.add(f.id);
 return ids;
}
