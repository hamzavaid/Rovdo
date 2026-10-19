import { createHash } from 'node:crypto';
import { ImportPreviewSchema, PartialDateSchema } from '@rovdo/shared';
import type { ImportPreview, Intelligence, ProfileFact } from '@rovdo/shared';
import { SKILLS, resolveSkill, roleOf } from '@rovdo/career';
import type { ParsedDocument, DocumentBlock } from './document';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const norm=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function parseDate(value:string):string|null {
 const words=/\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(19\d{2}|20\d{2})\b/i.exec(value);
 if(words)return `${words[2]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(words[1]!.slice(0,3).toLowerCase())+1).padStart(2,'0')}`;
 const iso=/\b(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?\b/.exec(value)?.[0];return iso&&PartialDateSchema.safeParse(iso).success?iso:null;
}
const rangePattern=/((?:[A-Za-z]+\s+)?(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?)\s*(?:-|\u2013|\u2014|to)\s*((?:[A-Za-z]+\s+)?(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?|present|current)/i;
export function recognizedSkills(text:string, explicit=false) {
 const matches: {id:string;start:number;end:number}[]=[];
 // Aspirations, negation and incidental prose are not qualifications.
 const segments=text.split(/[;\n]|(?<=[.!?])\s+(?=[A-Z])/);
 let offset=0;
 for(const segment of segments){
  if(!/\b(?:no|not|never|without|lack|lacking|interested in|want to learn|learning goals)\b/i.test(segment))for(const skill of SKILLS)for(const alias of skill.aliases){
   if(alias.context==='skill'&&!explicit&&!/\b(?:built|developed|implemented|using|used|programmed|firmware|language|stack|drivers|rtos|robotics|wrote)\b/i.test(segment))continue;
   // Single-letter/ordinary-word aliases need an explicit list or a direct usage phrase.
   if(['go','r','c','arm','spring','express','rust','swift','julia','gazebo'].includes(alias.label.toLowerCase())&&!explicit&&!new RegExp(String.raw`(?:using|used|with|in|programmed|wrote)\s+${escape(alias.label)}(?:\b|$)`,'i').test(segment))continue;
   const re=new RegExp(String.raw`(?:^|[^\p{L}\p{N}_.+#])(${escape(alias.label)})(?=$|[^\p{L}\p{N}_.+#]|\.(?=\s|$))`,'giu');
   for(const m of segment.matchAll(re)){const start=offset+m.index!+m[0].length-m[1]!.length;matches.push({id:skill.id,start,end:start+m[1]!.length});}
  }offset+=segment.length+1;
 }
 const kept=matches.filter(m=>!matches.some(other=>other.id!==m.id&&other.start<=m.start&&other.end>=m.end&&other.end-other.start>m.end-m.start));
 return [...new Set(kept.map(m=>m.id))];
}
const sectionName=(line:string):string|null=>{
 const s=norm(line.replace(/[:\s]+$/,''));
 if(/^(technical |core |programming |professional )?(skills|technologies|competencies|toolbox)$/.test(s))return 'skills';
 if(/^(professional |work |relevant )?(experience|employment|positions|work history)$/.test(s))return 'experience';
 if(/^(education|academic background|academic qualifications)$/.test(s))return 'education';
 if(/^(selected |technical |personal |academic )?projects$/.test(s))return 'projects';
 if(/^(certifications|licenses|certificates|certifications & licenses)$/.test(s))return 'certifications';
 if(/^(summary|profile|interests|hobbies|references|awards|publications|contact|languages|volunteering)$/.test(s))return 'other';return null;
};
export function previewDocument(doc:ParsedDocument,name:string,kind:ImportPreview['source']['kind'],capturedAt:string):ImportPreview {
 const hash=sha(JSON.stringify(doc));const source={id:`source:${hash}`,name:name.slice(0,200),kind,format:doc.format,sha256:hash,capturedAt};
 const intel:Intelligence={schemaVersion:'intelligence-v2',evidence:[],skills:[],experience:[],education:[],projects:[],certifications:[]};const facts:ProfileFact[]=[];const warnings=[...doc.warnings];
 const warn=(s:string)=>{if(warnings.length<48&&!warnings.includes(s))warnings.push(s.slice(0,500));};
 const bound=(excerpt:string,locator='',confidence=.85)=>{const id=`e:${sha(`${source.id}:${locator}:${excerpt}`).slice(0,32)}`;if(!intel.evidence.some(e=>e.id===id))intel.evidence.push({id,sourceId:source.id,sourceKind:kind,excerpt:excerpt.slice(0,4000),sha256:sha(excerpt.slice(0,4000)),confidence,verified:false,location:locator.slice(0,400)});return {id,evidenceIds:[id],verified:false};};
 const addSkills=(text:string,evidenceId:string,explicit:boolean,depth:'declared'|'project'|'supporting')=>{
  const ids=recognizedSkills(text,explicit);
  if(explicit)for(const token of text.split(/[,;|\n]/).map(s=>s.replace(/^[\w /&]+:\s*/, '').trim()).filter(Boolean)){
   if(token.length<=80&&token.split(/\s+/).length<=5&&!/[.!?]/.test(token)&&!recognizedSkills(token,true).length&&!/\b(no|not|never|without|lack|lacking|none|interested|learning|experience|year|skill)\b/i.test(token)){
    const id=`custom:${norm(token).replace(/[^a-z0-9+#.-]+/g,'-')}`;if(id.length>7){ids.push(id);warn(`Unrecognized declared skill "${token}" retained for review.`);if(!intel.skills.some(s=>s.skillId===id))intel.skills.push({id:`skill:${hash.slice(0,16)}:${id}`,skillId:id,displayName:token,version:null,depth:'declared',recognition:'explicit',evidenceIds:[evidenceId],verified:false});}
   }
  }
  for(const skillId of new Set(ids)){
   const old=intel.skills.find(s=>s.skillId===skillId);if(old){old.evidenceIds=[...new Set([...old.evidenceIds,evidenceId])].slice(0,50);if(explicit)old.recognition='explicit';continue;}
   const skill=SKILLS.find(s=>s.id===skillId);const version=skill?.aliases.flatMap(a=>new RegExp(String.raw`${escape(a.label)}\s+(\d+(?:\.\d+){0,2})`,'i').exec(text)?.[1]??[])[0]??null;
   intel.skills.push({id:`skill:${hash.slice(0,16)}:${skillId}`,skillId,version,depth,recognition:explicit?'explicit':'contextual',evidenceIds:[evidenceId],verified:false});
  }return [...new Set(ids)];
 };
 const dates=(text:string)=>{const m=rangePattern.exec(text);let start=m?parseDate(m[1]!):null;let end=m&&!/present|current/i.test(m[2]!)?parseDate(m[2]!):null;if(start&&end&&start>end){start=null;end=null;warn('Reversed employment/project dates left unknown; correct during review.');}if(m&&(!start||(!end&&!/present|current/i.test(m[2]!))))warn('Invalid date left unknown; correct during review.');if(!m)warn('Missing or ambiguous employment/project date range; duration remains unknown.');return {start,end,ongoing:!!m&&/present|current/i.test(m[2]!)};};
 const degree=(text:string)=>/\b(bachelor|b\.?sc\b|b\.?s\.?\b|master|m\.?sc\b|m\.?s\.?\b|ph\.?d\b|doctorate|associate|high school)\b/i.exec(text)?.[0];
 const record=(section:string,blocks:DocumentBlock[])=>{
  if(!blocks.length)return;const text=blocks.map(b=>b.text).join('\n').slice(0,4000);if(!text.trim())return;
  const locator=blocks.map(b=>b.path??(b.page?`page:${b.page}/column:${b.column}/y:${b.y}`:'')).join(';');const b=bound(text,locator);
  if(section==='skills'){addSkills(text,b.id,true,'declared');return;}
  const skills=section==='experience'||section==='projects'?addSkills(text,b.id,false,section==='projects'?'project':'supporting'):[];
  const first=blocks[0]!.text;const parts=first.split('|').map(s=>s.trim());
  if(section==='experience'){
   const title=parts[0]!.replace(rangePattern,'').trim();if(!title){warn('Employment without a title requires manual review.');return;}
   const organization=parts[1]&&!rangePattern.test(parts[1])?parts[1]:blocks[1]&&!rangePattern.test(blocks[1].text)&&!/\b(built|developed|used|designed)\b/i.test(blocks[1].text)?blocks[1].text:'';
   if(!organization)warn('Employment has no employer identified; review the organization.');const role=roleOf(title); intel.experience.push({...b,title,organization,roleFamily:role.family,level:role.level,track:role.track,...dates(text),skills,production:/\b(?:production|deployed)\b/i.test(text)});
  }else if(section==='education'){
   const d=degree(text);if(!d){warn('Education with no recognized degree retained as an incomplete other qualification.');}
   const level=!d?'other':/bachelor|^b/i.test(d)?'bachelor':/master|^m/i.test(d)?'master':/associate/i.test(d)?'associate':/high school/i.test(d)?'high-school':'doctorate';
   const fragments=blocks.flatMap(b=>b.text.split('|').map(s=>s.trim()));
   const institution=fragments.find(s=>/university|college|institute|school|polytechnic/i.test(s)&&!degree(s))??(parts.length>1?parts.find(s=>!!s&&!degree(s)&&!parseDate(s)&&!/expected|completed|graduated|enrolled|studying/i.test(s)):null)??'';
   if(!institution)warn('Education has no reliably identified school/institution; add it during review.');
   const field=/\b(?:in|of science in|of arts in)\s+(.+?)(?:\s*\||\b(?:expected|completed|graduated)\b|$)/i.exec(text.split('\n').find(t=>degree(t))??'')?.[1]?.trim()??'';
   const datesFound=[...text.matchAll(/\b(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?\b/g)];const graduation=parseDate(text.match(/(?:expected|graduated|completed)[^\n|]*/i)?.[0]??'')??(datesFound.at(-1)?parseDate(text.slice(Math.max(0,datesFound.at(-1)!.index!-12))):null);
   intel.education.push({...b,level,institution,field,status:/expected/i.test(text)?'expected':/pursuing|enrolled|studying/i.test(text)?'enrolled':/completed|graduated|earned/i.test(text)?'completed':'incomplete',graduation});
   if(!/expected|pursuing|enrolled|studying|completed|graduated|earned/i.test(text))warn('Degree completion is not inferred from a school or date. Review education status.');
  }else if(section==='projects')intel.projects.push({...b,name:first.replace(/^Project:\s*/i,'').split('|')[0]!,description:text,roleFamily:roleOf(text).family,skills,...dates(text),production:false,url:/https:\/\/[^\s|]+/.exec(text)?.[0]??blocks.flatMap(b=>b.links??[])[0]??null});
  else if(section==='certifications')intel.certifications.push({...b,name:parts[0]!,issuer:parts[1]??blocks[1]?.text??'',expires:/expir/i.test(text)?parseDate(text.match(/expir[^\n]*/i)?.[0]??''):null,license:/licen[cs]e/i.test(text)});
 };
 let section='other';let pending:DocumentBlock[]=[];let previousColumn='';
 const flush=()=>{record(section,pending);pending=[];};
 for(const original of doc.blocks){const block={...original,text:original.text.normalize('NFKC').trim()};const line=block.text;
  const column=block.page?`${block.page}:${block.column}`:'';if(previousColumn&&column&&column!==previousColumn){flush();section='other';}previousColumn=column;
  if(!line){flush();continue;}
  if(/^(?:gender|sex|birth|date of birth|ethnicity|religion|age|marital status)\b/i.test(line))continue;
  const legal=/^(citizenship|work authorization|clearance)\s*:\s*(.+)$/i.exec(line);if(legal){facts.push({id:`fact:${sha(line).slice(0,24)}`,field:/citizen/i.test(legal[1]!)?'citizenship':/clearance/i.test(legal[1]!)?'clearance':'workAuthorization',value:legal[2]!,verified:false,source:{kind:'user',reference:`Unconfirmed import from ${name}`,capturedAt}});continue;}
  const inline=/^([^:]{2,40}):\s*(.*)$/.exec(line);const next=sectionName(inline?.[1]??line);if(next){flush();section=next;if(inline?.[2])pending.push({...block,text:inline[2]});continue;}
  if(section==='other'){bound(line,block.path??(block.page?`page:${block.page}/column:${block.column}`:''),.4);continue;}
  const header=block.kind==='heading'||(/^Project:/i.test(line))||section==='experience'&&(/\|/.test(line)&&!/^\s*(?:19|20)\d{2}/.test(line)||/\b(?:engineer|developer|intern|analyst|manager|technician|scientist)\b/i.test(line)&&!rangePattern.test(line)&&line.length<120&&!/\b(?:built|used|developed|implemented)\b/i.test(line))||section==='education'&&!!degree(line)&&pending.some(b=>!!degree(b.text))||section==='projects'&&line.includes('|')&&pending.length>0||section==='certifications'&&line.includes('|');
  if(header&&pending.length)flush();pending.push(block);
 }flush();
 for(const table of doc.tables)for(const [index,row] of table.rows.entries()){
  const get=(...names:string[])=>names.map(n=>Object.entries(row).find(([key])=>norm(key)===norm(n))?.[1]?.trim()).find(Boolean)??'';
  let type=/([^/]+)\.csv$/i.exec(table.name)?.[1]?.toLowerCase()??'';
  if(type==='archive'){const headers=new Set(Object.keys(row).map(norm));type=headers.has('company name')&&headers.has('title')?'positions':headers.has('school name')&&headers.has('degree name')?'education':headers.has('authority')&&headers.has('name')?'certifications':headers.has('title')&&headers.has('description')?'projects':headers.size===1&&headers.has('name')?'skills':'unsupported';}
  const excerpt=JSON.stringify(row);const b=bound(excerpt,`${table.name}/row:${index+2}`,.95);
  if(type==='skills'||type==='archive'&&get('Name')&&!get('Title','Company Name')){addSkills(get('Name'),b.id,true,'declared');}
  else if(type==='positions'||type==='archive'&&get('Title')&&get('Company Name')){
   const title=get('Title'),start=parseDate(get('Started On')),end=parseDate(get('Finished On'));if(!title){warn('Skipped LinkedIn position missing a title.');continue;}
   if(!get('Finished On'))warn('LinkedIn position has no end date; confirm whether it is ongoing.');const role=roleOf(title);
   const skills=addSkills(get('Description'),b.id,false,'supporting');const invalid=start&&end&&start>end;if(invalid)warn('Reversed LinkedIn employment dates left unknown.');
   intel.experience.push({...b,title,organization:get('Company Name'),roleFamily:role.family,level:role.level,track:role.track,start:invalid?null:start,end:invalid?null:end,ongoing:/present|current/i.test(get('Finished On')),skills,production:false});
  }else if(type==='education'){
   const d=get('Degree Name'),level=/bachelor|b\.?sc|b\.?s\b/i.test(d)?'bachelor':/master|m\.?sc/i.test(d)?'master':/phd|doctor/i.test(d)?'doctorate':/associate/i.test(d)?'associate':'other';
   intel.education.push({...b,level,field:get('Field Of Study'),institution:get('School Name'),status:/expected/i.test(get('Notes','End Date'))?'expected':'incomplete',graduation:parseDate(get('End Date'))});warn('LinkedIn school dates do not prove degree completion; review status.');
  }else if(type==='projects'){const description=get('Description'),skills=addSkills(description,b.id,false,'project');if(get('Title','Name'))intel.projects.push({...b,name:get('Title','Name'),description,roleFamily:roleOf(description).family,skills,start:parseDate(get('Started On')),end:parseDate(get('Finished On')),production:false,url:/^https?:\/\//.test(get('Url'))?get('Url'):null});}
  else if(type==='certifications'&&get('Name'))intel.certifications.push({...b,name:get('Name'),issuer:get('Authority'),expires:parseDate(get('Finished On')),license:false});
  else if(type==='profile')warn('LinkedIn summary/contact data was not interpreted as verified qualifications.');else warn(`Unsupported LinkedIn columns in ${table.name}; no qualifications inferred.`);
 }
 if(!intel.education.length)warn('No structured education identified. Add it during review; no degree completion is inferred.');
 if(!intel.experience.length)warn('No supported employment records identified. Dates and duration remain unknown.');
 warn('All imported qualifications need explicit review. Mentions do not establish proficiency, authorship or employment.');
 // Natural-key dedup within a source (e.g. repeated archive rows).
 for(const key of ['skills','education','experience','projects','certifications'] as const){const seen=new Map<string,(typeof intel)[typeof key][number]>();const target=intel[key] as (typeof intel)[typeof key][number][];for(const item of target){const id=qualificationIdentity(item);const old=seen.get(id);if(old)old.evidenceIds=[...new Set([...old.evidenceIds,...item.evidenceIds])].slice(0,50);else seen.set(id,item);}target.splice(0,target.length,...seen.values());}
 return ImportPreviewSchema.parse({id:`import:${hash}`,parserVersion:'profile-import-v2',status:'ready',source,intelligence:intel,facts,warnings});
}
export function qualificationIdentity(x: Intelligence['skills'][number]|Intelligence['education'][number]|Intelligence['experience'][number]|Intelligence['projects'][number]|Intelligence['certifications'][number]):string {
 if('skillId'in x)return norm(resolveSkill(x.skillId,'skill')?.id??x.skillId);
 if('organization'in x)return norm(`${x.title}|${x.organization}|${x.start}`);
 if('institution'in x)return norm(`${x.level}|${x.field}|${x.institution}`);
 return norm(`${x.name}|${'url'in x?x.url??'':x.issuer}`);
}
