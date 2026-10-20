import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ImportPreviewSchema, IntelligenceSchema, importAssistancePayload } from '@rovdo/shared';
import type { ImportPreview, ImportPrivacyOptions } from '@rovdo/shared';
import { parseDate, recognizedSkills } from './parser';
import { resolveSkill } from '@rovdo/career';
const sensitive=/\b(?:citizenship|work authori[sz]ation|clearance|gender|ethnicity|religion|date of birth|marital status|passport|social security)\b/i;
export const assistancePayload = importAssistancePayload;
const citation={evidenceId:z.string().max(200),quote:z.string().trim().min(1).max(4000),value:z.string().trim().min(1).max(4000)};
const Suggestions=z.strictObject({suggestions:z.array(z.discriminatedUnion('op',[
 z.strictObject({op:z.literal('skill'),...citation}),
 z.strictObject({op:z.literal('correct'),...citation,section:z.enum(['skills','experience','education','projects','certifications']),recordId:z.string().max(200),field:z.enum(['skillId','version','title','organization','start','end','field','institution','graduation','name','description','url','issuer','expires'])}),
])).max(30)});
export function applyAssistance(input:ImportPreview,output:unknown,options:ImportPrivacyOptions={}):ImportPreview {
 const preview=ImportPreviewSchema.parse(input);if(preview.status!=='ready')throw new Error('IMPORT_ALREADY_REVIEWED');
 const parsed=Suggestions.parse(output);const payload=assistancePayload(preview,options);const allowed=new Map(payload.evidence.map(e=>[e.id,e]));const intel=structuredClone(preview.intelligence);
 for(const s of parsed.suggestions){const e=allowed.get(s.evidenceId);if(!e||!e.excerpt.includes(s.quote)||sensitive.test(s.quote)||/\[redacted/i.test(s.quote))throw new Error('UNSUPPORTED_EVIDENCE');
  if(s.op==='skill'){
   const skill=resolveSkill(s.value,'skill');if(!skill||!recognizedSkills(s.quote,true).includes(skill.id))throw new Error('UNSUPPORTED_SKILL');
   const existing=intel.skills.find(x=>x.skillId===skill.id);if(existing){existing.evidenceIds=[...new Set([...existing.evidenceIds,e.id])].slice(0,50);existing.verified=false;}
   else intel.skills.push({id:`ai:skill:${skill.id}`,skillId:skill.id,version:null,depth:'declared',recognition:'inferred',evidenceIds:[e.id],verified:false});
  }else{
   const record=intel[s.section].find(r=>r.id===s.recordId);if(!record||!record.evidenceIds.includes(e.id)||!(s.field in record))throw new Error('INVALID_CORRECTION');
   let value=s.value;
   if(s.field==='skillId'){const skill=resolveSkill(value,'skill');if(!skill||!recognizedSkills(s.quote,true).includes(skill.id))throw new Error('UNSUPPORTED_SKILL');value=skill.id;}
   else if(['start','end','graduation','expires'].includes(s.field)){if(parseDate(s.quote)!==value)throw new Error('UNSUPPORTED_DATE');}
   else if(!s.quote.toLowerCase().includes(value.toLowerCase()))throw new Error('UNSUPPORTED_VALUE');
   Object.assign(record,{[s.field]:value,verified:false});
  }
 }
 for(const key of ['skills','experience','education','projects','certifications'] as const)intel[key].forEach(r=>{r.verified=false;});intel.evidence.forEach(e=>{e.verified=false;});
 const hash=createHash('sha256').update(JSON.stringify([preview.source.sha256,parsed])).digest('hex');
 return ImportPreviewSchema.parse({...preview,id:`assisted:${hash}`,intelligence:IntelligenceSchema.parse(intel),warnings:[...preview.warnings.slice(0,48),'AI-assisted suggestions: citations were checked, but correctness and all qualifications still require your independent review.']});
}
