import { CandidateProfileSchema, JobSchema, RankingProfileSchema, ApprovedApplicationContextSchema, qualificationSupport, EVIDENCE_POLICY_VERSION, contentHash, sha256Text, validateApprovedApplicationContext } from '@rovdo/shared';
import type { CandidateProfile, Job, RankingProfile, ApprovedApplicationContext, Intelligence } from '@rovdo/shared';
import { intelligenceOf, CANDIDATE_POLICY_VERSION } from './candidate';
import { SCORING_POLICY_VERSION } from './scorer-v2';
import { extractRequirements } from './requirements';
export { validateApprovedApplicationContext } from '@rovdo/shared';
export type ApplicationContextRequest={profile:CandidateProfile;job:Job;ranking:RankingProfile;template:ApprovedApplicationContext['template'];approval:ApprovedApplicationContext['approval']};
/** Local preparation only: no model calls, document rendering, persistence or submission. */
export async function buildApprovedApplicationContext(input:ApplicationContextRequest):Promise<ApprovedApplicationContext>{
 const profile=CandidateProfileSchema.parse(input.profile),job=JobSchema.parse(input.job),ranking=RankingProfileSchema.parse(input.ranking);const intel=intelligenceOf(profile);const evidence=new Map(intel.evidence.filter(e=>e.verified).map(e=>[e.id,e]));
 for(const [id,e] of evidence) if(e.sourceKind!=='legacy'&&e.sha256!==await sha256Text(e.excerpt))evidence.delete(id);
 const selected: Intelligence={schemaVersion:'intelligence-v2',evidence:[],skills:[],experience:[],education:[],projects:[],certifications:[]};const omitted:ApprovedApplicationContext['omitted']=[];const claims:ApprovedApplicationContext['claims']=[];
 const found=new Set<string>();
 for(const key of ['skills','experience','education','projects','certifications'] as const)for(const item of intel[key]){const id=`${key}:${item.id}`;if(!input.approval.qualificationIds.includes(id))continue;found.add(id);const support=qualificationSupport(item,evidence);if(!item.verified||support.conflict||support.confidence<=0||support.confidence<ranking.minimumEvidence){omitted.push({id,reason:!item.verified?'unverified':support.conflict?'conflicting':'unsupported'});continue;}const next={...structuredClone(item),evidenceIds:support.evidenceIds};(selected[key] as typeof item[]).push(next);claims.push({subject:id,evidenceIds:next.evidenceIds,contentSha256:await contentHash(next)});}
 for(const id of input.approval.qualificationIds)if(!found.has(id))throw new Error('UNKNOWN_APPROVED_QUALIFICATION');
 const facts:ApprovedApplicationContext['candidate']['facts']=[];
 for(const id of input.approval.factIds){const fact=profile.facts.find(f=>f.id===id);if(!fact)throw new Error('UNKNOWN_APPROVED_FACT');if(!fact.verified||['citizenship','workAuthorization','clearance'].includes(fact.field)){omitted.push({id:`fact:${id}`,reason:fact.verified?'sensitive':'unverified'});continue;}
 const ref=`approved-fact:${id.slice(0,150)}`;const excerpt=JSON.stringify({value:fact.value,source:fact.source});const e={id:ref,sourceId:`user-approval:${id.slice(0,150)}`,sourceKind:'user' as const,excerpt,sha256:await sha256Text(excerpt),confidence:1,verified:true};if(excerpt.length>4000)throw new Error('FACT_EVIDENCE_LIMIT');selected.evidence.push(e);const next={...fact,verified:true as const,evidenceIds:[ref]};facts.push(next);claims.push({subject:`fact:${id}`,evidenceIds:[ref],contentSha256:await contentHash(next)});
 }
 const refs=new Set(claims.flatMap(c=>c.evidenceIds));for(const e of intel.evidence)if(refs.has(e.id)&&evidence.has(e.id))selected.evidence.push({...e,sha256:await sha256Text(e.excerpt)});
 const requirements=extractRequirements(job.descriptionText,job.title);const candidate={facts,qualifications:selected};
 const body={contractVersion:'approved-application-v1' as const,job,candidate,requirements,ranking,template:input.template,approval:input.approval,claims,omitted,versions:{profileVersion:profile.version,scorerPolicy:SCORING_POLICY_VERSION,candidatePolicy:CANDIDATE_POLICY_VERSION,evidencePolicy:EVIDENCE_POLICY_VERSION,taxonomyVersion:requirements.taxonomyVersion,requirementsParserVersion:requirements.parserVersion}};
 const parts={job:await contentHash(job),candidate:await contentHash(candidate),requirements:await contentHash(requirements),ranking:await contentHash(ranking),template:await contentHash(input.template)};
 return validateApprovedApplicationContext(ApprovedApplicationContextSchema.parse({...body,hashes:{...parts,context:await contentHash({...body,hashes:parts})}}));
}
