import { expect, it } from 'vitest';
import { previewDocument, extractDocument, mergeReviewed } from './index';
import { qualificationSupport } from '@rovdo/shared';
import { stabilityImports } from '../../../tests/fixtures/profile-stability';
const at='2026-10-20T00:00:00.000Z';
it('measures qualification fields on anonymized PDF, table DOCX and LinkedIn archive fixtures',async()=>{
 let tp=0,fp=0,fn=0,skillFp=0;
 for(const f of stabilityImports){const p=previewDocument(await extractDocument(f.format,f.bytes),f.name,f.kind,at);const i=p.intelligence;
 const actual=[...i.skills.map(s=>`skill:${s.skillId}`),...i.experience.flatMap(w=>[`title:${w.title}`,`employer:${w.organization}`,`start:${w.start}`,`end:${w.end}`]),...i.education.flatMap(e=>[`school:${e.institution}`,`status:${e.status}`,`graduation:${e.graduation}`]),...i.projects.map(p=>`project:${p.name}`)];
 const expected=[...f.skills.map(s=>`skill:${s}`),`title:${f.work[0]}`,`employer:${f.work[1]}`,`start:${f.work[2]}`,`end:${f.work[3]}`,`school:${f.school[0]}`,`status:${f.school[1]}`,`graduation:${f.school[2]}`,`project:${f.project}`];
 tp+=actual.filter(x=>expected.includes(x)).length;fp+=actual.filter(x=>!expected.includes(x)).length;fn+=expected.filter(x=>!actual.includes(x)).length;skillFp+=i.skills.filter(s=>!(f.skills as readonly string[]).includes(s.skillId)).length;
 expect(i.evidence.every(e=>!e.verified)).toBe(true);expect(JSON.stringify(p)).not.toContain('Gender');
 }
 const measured={precision:tp/(tp+fp),recall:tp/(tp+fn),falsePositives:fp,falsePositiveSkills:skillFp};
 // eslint-disable-next-line no-console -- Provisional regression measurements, not general accuracy claims.
 console.info('v0.3.8 provisional document field metrics',JSON.stringify(measured));
 expect(measured).toEqual({precision:1,recall:1,falsePositives:0,falsePositiveSkills:0});
});
it('keeps multi-source approval idempotent and confidence monotonic',async()=>{
 const f=stabilityImports[0];const a=previewDocument(await extractDocument(f.format,f.bytes),f.name,f.kind,at);const ids=a.intelligence.skills.map(s=>s.id);const base=mergeReviewed(null,a,ids,false);const skill=base.intelligence!.skills.find(s=>s.skillId==='cpp')!;
 const support=()=>qualificationSupport(skill,new Map(base.intelligence!.evidence.map(e=>[e.id,e]))).confidence;const before=support();
 const b=structuredClone(a);b.id='other-source';b.source.id='other-source';b.intelligence.evidence.forEach(e=>{e.id='second:'+e.id;e.confidence=.2;});for(const key of ['skills','experience','education','projects','certifications'] as const)b.intelligence[key].forEach(q=>{q.evidenceIds=q.evidenceIds.map(id=>'second:'+id);});
 const merged=mergeReviewed(base,b,ids,false);const next=merged.intelligence!.skills.find(s=>s.skillId==='cpp')!;
 expect(qualificationSupport(next,new Map(merged.intelligence!.evidence.map(e=>[e.id,e]))).confidence).toBeGreaterThanOrEqual(before);expect(merged.intelligence!.skills).toHaveLength(base.intelligence!.skills.length);
 expect(mergeReviewed(merged,b,ids,false).intelligence).toEqual(merged.intelligence);
});

it('retains conflicting archive rows for review instead of blending their evidence',async()=>{const {zipFixture}=await import('../../../tests/fixtures/profile-files');const doc=await extractDocument('zip',zipFixture({'Positions.csv':'Company Name,Title,Started On,Finished On,Description\nSample Labs,Engineer,2020-01,2023-12,Built TypeScript services\nSample Labs,Engineer,2020-01,2024-12,Built TypeScript services\nSample Labs,Engineer,2020-01,2023-12,Built TypeScript services'}));const p=previewDocument(doc,'conflict.zip','linkedin',at);expect(p.intelligence.experience).toHaveLength(2);expect(p.intelligence.experience.every(q=>q.conflictWith?.length)).toBe(true);expect(p.warnings.join(' ')).toMatch(/conflict/i);expect(()=>mergeReviewed(null,p,p.intelligence.experience.map(q=>q.id),false)).toThrow();const resolved=mergeReviewed(null,p,[p.intelligence.experience[0]!.id],false);expect(resolved.intelligence!.experience).toHaveLength(1);expect(resolved.intelligence!.experience[0]!.conflictWith).toBeUndefined();});
