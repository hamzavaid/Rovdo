import { COMPONENTS, IntelligenceSchema, JobMatchSchema, RankingProfileSchema } from '@rovdo/shared';
import type { CandidateProfile, Intelligence, Job, JobMatch, RankingDetails, RankingProfile, Requirement } from '@rovdo/shared';
import { rankJobs, evaluateEligibility } from './index';
import { degreeGate, extractRequirements, unionMonths } from './requirements';
import { matchSkill, resolveSkill, roleOf, TAXONOMY_VERSION } from './taxonomy';

type Weights = RankingProfile['weights'];
const weights = (partial: Partial<Weights>): Weights => Object.fromEntries(COMPONENTS.map((key) => [key, partial[key] ?? 0])) as Weights;
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
const preset = (id: string, name: string, method: RankingProfile['method'], parts: Partial<Weights>, extras: Partial<RankingProfile> = {}): RankingProfile => RankingProfileSchema.parse({ id: `builtin:${id}`, name, revision: 1, schemaVersion: 1, method, weights: weights(parts), requiredMultiplier: 3, preferredMultiplier: 1, implicationCredit: .85, minimumEvidence: .5, gates: { education: true, location: true, salary: false, requiredSkills: false, experience: false }, thresholds: { score: 80, confidence: .75, coverage: .85 }, ...extras });
export const BUILTIN_RANKINGS: readonly RankingProfile[] = freeze([
  preset('legacy-v1', 'Legacy v1', 'legacy-v1', { skills: 35, role: 20, location: 15, eligibility: 20, preferences: 10 }),
  preset('technical-balanced', 'Technical Balanced v2', 'technical-v2', { skills: 30, experience: 19, projects: 14, seniority: 10, role: 8, depth: 7, education: 4, lexical: 3 }),
  preset('technical-conservative', 'Technical Conservative v2', 'technical-v2', { skills: 34, experience: 21, projects: 13, seniority: 11, role: 6, depth: 8, education: 4, lexical: 1 }, { implicationCredit: 0, minimumEvidence: .85, requiredMultiplier: 4, thresholds: { score: 85, confidence: .8, coverage: .9 } }),
  preset('technical-lenient', 'Technical Lenient v2', 'technical-v2', { skills: 26, experience: 15, projects: 17, seniority: 8, role: 10, depth: 7, education: 3, lexical: 6 }, { implicationCredit: .9, minimumEvidence: .4, thresholds: { score: 72, confidence: .65, coverage: .7 } }),
  preset('opportunity-hybrid', 'Opportunity Hybrid', 'opportunity-v2', { skills: 30, role: 18, experience: 15, location: 12, salary: 8, education: 7, lexical: 7, company: 3 }),
]);
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
// A deterministic cache fingerprint, not a cryptographic authorization digest.
export function fingerprint(value: unknown): string { let hash = 14695981039346656037n; for (const c of stable(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(c.charCodeAt(0))) * 1099511628211n); return hash.toString(16).padStart(16, '0'); }
export function intelligenceOf(profile: CandidateProfile): Intelligence {
  if (profile.intelligence) return IntelligenceSchema.parse(profile.intelligence);
  const evidence = profile.facts.map((f) => ({ id: f.id, sourceId: `legacy:${f.id}`, sourceKind: 'legacy' as const, excerpt: f.value, sha256: '0'.repeat(64), confidence: f.source.kind === 'user' ? .9 : .75, verified: f.verified }));
  const skills = profile.facts.flatMap((f) => { const skill = f.field === 'skill' ? resolveSkill(f.value, 'skill') : null; return skill ? [{ id: f.id, skillId: skill.id, version: null, evidenceIds: [f.id], verified: f.verified, depth: 'declared' as const }] : []; });
  const education = profile.facts.flatMap((f) => { const level = /bachelor|master|doctorate|associate|high-school/i.exec(f.value)?.[0]?.toLowerCase(); return f.field === 'degree' && level ? [{ id: f.id, level, field: '', institution: '', status: /expected|enroll|pursu/i.test(f.value) ? 'expected' : 'completed', graduation: null, verified: f.verified, evidenceIds: [f.id] }] : []; });
  return IntelligenceSchema.parse({ schemaVersion: 'intelligence-v2', evidence, skills, education, experience: [], projects: [], certifications: [] });
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const rounded = (n: number) => Math.round(n * 1000000) / 1000000;
const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const relevant = (a: string, b: string, transfer: number) => a === b && a !== 'unknown' ? 1 : [a, b].every((f) => ['software', 'platform'].includes(f)) ? transfer * .7 : 0;
const depthValue = { production: 1, project: .9, supporting: .75, course: .35, declared: .4 };

export function rankWithProfile(rows: { job: Job; bm25Raw: number }[], profile: CandidateProfile, input: RankingProfile, asOf: string): JobMatch[] {
  const config = RankingProfileSchema.parse(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('AS_OF_REQUIRED');
  if (config.method === 'legacy-v1') {
    const total = config.weights.skills + config.weights.role + config.weights.location + config.weights.eligibility + config.weights.preferences;
    if (!total) throw new Error('NO_LEGACY_WEIGHTS');
    return rankJobs(rows, { ...profile, preferences: { ...profile.preferences, weights: { skills: config.weights.skills / total, role: config.weights.role / total, location: config.weights.location / total, eligibility: config.weights.eligibility / total, preferences: config.weights.preferences / total } } }).map((m) => ({ ...m, ranking: { method: config.method, configId: config.id, configRevision: config.revision, configHash: fingerprint(config), taxonomyVersion: 'legacy-v1', parserVersion: 'legacy-v1', evidenceVersion: fingerprint(profile.facts.filter((f) => !['name', 'email', 'phone', 'citizenship'].includes(f.field))), asOf, technicalScore: null, preferenceScore: null, requiredCoverage: 0, shortlist: !m.excluded && m.score >= config.thresholds.score && m.confidence >= config.thresholds.confidence, components: [], requirements: [] } }));
  }
  const intel = intelligenceOf(profile);
  const configHash = fingerprint(config); const evidenceVersion = fingerprint(intel);
  const evidence = new Map(intel.evidence.map((e) => [e.id, e]));
  const confidenceOf = (item: { verified: boolean; evidenceIds: string[] }) => item.verified ? Math.min(...item.evidenceIds.map((id) => { const e = evidence.get(id); return e?.verified ? e.confidence : 0; })) : 0;
  const usable = <T extends { verified: boolean; evidenceIds: string[] }>(items: T[]) => items.filter((i) => confidenceOf(i) >= config.minimumEvidence);
  const skills = usable(intel.skills); const work = usable(intel.experience); const projects = usable(intel.projects); const education = usable(intel.education); const certifications = usable(intel.certifications);
  const results = rows.map(({ job, bm25Raw }): JobMatch => {
    const parsed = extractRequirements(job.descriptionText, job.title);
    const skillRequirements = parsed.items.filter((r) => r.kind === 'skill' && r.importance !== 'mentioned');
    const importance = (r: Requirement) => r.importance === 'required' ? config.requiredMultiplier : r.importance === 'preferred' ? config.preferredMultiplier : .2;
    const matches = skillRequirements.map((r) => {
      const possible = skills.flatMap((s) => [r.skillId!, ...r.alternatives].map((required) => ({ s, ...matchSkill(s.skillId, required, s.version, r.versionRange, config.implicationCredit) })));
      possible.sort((a, b) => b.strength - a.strength || confidenceOf(b.s) - confidenceOf(a.s) || a.s.id.localeCompare(b.s.id));
      const best = possible[0]; const strength = best?.strength ?? 0;
      return { r, strength, confidence: strength ? confidenceOf(best!.s) * r.confidence : 0, depth: strength ? depthValue[best!.s.depth] * strength : 0, ids: strength ? best!.s.evidenceIds : [], reason: best && strength ? best.reason : 'No verified matching evidence' };
    });
    const weighted = (values: { r: Requirement; value: number }[]) => values.length ? values.reduce((a, v) => a + importance(v.r) * v.value, 0) / values.reduce((a, v) => a + importance(v.r), 0) : null;
    const required = matches.filter((m) => m.r.importance === 'required');
    const coverage = required.length ? required.filter((m) => m.strength >= .8).length / required.length : 1;
    const components = new Map<string, { value: number | null; confidence: number; explanation: string }>();
    const add = (name: string, value: number | null, confidence: number, explanation: string) => components.set(name, { value: value === null ? null : rounded(clamp(value)), confidence: rounded(clamp(confidence)), explanation });
    add('skills', weighted(matches.map((m) => ({ r: m.r, value: m.strength }))), avg(matches.map((m) => m.confidence)), `${matches.filter((m) => m.strength > 0).length}/${matches.length} job skill requirements have verified evidence; required multiplier ${config.requiredMultiplier}, preferred ${config.preferredMultiplier}.`);
    add('depth', weighted(matches.map((m) => ({ r: m.r, value: m.depth }))), avg(matches.map((m) => m.confidence)), 'Depth uses verified production/project/supporting/course context, not keyword frequency.');
    const experienceRequirements = parsed.items.filter((r) => r.kind === 'experience' && r.months !== null);
    const experienceValues = experienceRequirements.map((r) => {
      const relevantWork = work.filter((w) => unionMonths([w], asOf) > 0 && relevant(w.roleFamily, r.roleFamily ?? 'unknown', config.implicationCredit) > 0 && (!r.skillId || w.skills.some((s) => matchSkill(s, r.skillId!, null, null, config.implicationCredit).strength > 0)));
      const months = unionMonths(relevantWork, asOf);
      return { r, value: Math.min(1, months / Math.max(1, r.months!)), confidence: avg(relevantWork.map(confidenceOf)) * r.confidence };
    });
    add('experience', weighted(experienceValues), avg(experienceValues.map((v) => v.confidence)), 'Relevant scoped employment intervals are unioned before comparing against requested months; absent year requirements are inactive.');
    const projectValues = projects.map((p) => {
      const matched = skillRequirements.length ? skillRequirements.filter((r) => p.skills.some((s) => matchSkill(s, r.skillId!, null, null, config.implicationCredit).strength > 0)).length / skillRequirements.length : 0;
      const role = relevant(p.roleFamily, parsed.role.family, config.implicationCredit);
      return { value: .65 * matched + .25 * role + .1 * Number(p.production), confidence: confidenceOf(p) };
    }).sort((a, b) => b.value - a.value);
    add('projects', skillRequirements.length ? projectValues.length ? projectValues[0]!.value * (projectValues.length > 1 ? .7 : 1) + (projectValues[1]?.value ?? 0) * .3 : 0 : null, avg(projectValues.slice(0, 2).map((v) => v.confidence)), 'Best two verified projects: required-stack coverage, role relevance and deployed context; 70/30 aggregation.');
    const candidateRoles = work.map((w) => ({ ...roleOf(w.title), family: w.roleFamily, level: w.level, track: w.track }));
    const roleScores = candidateRoles.map((r) => relevant(r.family, parsed.role.family, config.implicationCredit) * (r.track !== 'unknown' && parsed.role.track !== 'unknown' && r.track !== parsed.role.track ? .3 : 1));
    add('role', parsed.role.family === 'unknown' ? null : Math.max(0, ...roleScores), avg(work.map(confidenceOf)), 'Canonical family/track match; adjacent software/platform roles receive only curated partial credit.');
    const levels = ['intern', 'entry', 'junior', 'mid', 'senior', 'staff', 'principal', 'lead']; const requested = levels.indexOf(parsed.role.level);
    const levelsScores = candidateRoles.map((r) => { const n = levels.indexOf(r.level); if (n < 0) return 0; const delta = n - requested; return r.track !== parsed.role.track ? .2 : delta === 0 ? 1 : delta === 1 ? .85 : delta === -1 ? .65 : delta > 1 ? .6 : .3; });
    add('seniority', requested < 0 ? null : Math.max(0, ...levelsScores), avg(work.map(confidenceOf)), 'IC/management tracks remain distinct; no fixed years are invented from title level.');
    const checks = evaluateEligibility(job, { ...profile, facts: profile.facts.filter((f) => ['workAuthorization', 'citizenship', 'clearance', 'returnToSchool'].includes(f.field) && f.source.kind === 'user') }).filter((c) => ['open', 'workAuthorization', 'citizenship', 'clearance', 'returnToSchool', 'sponsorship-review'].includes(c.rule));
    const qualificationRequirements = parsed.items.filter((r) => r.kind === 'education' || r.kind === 'certification');
    const educationValues = qualificationRequirements.map((r) => {
      let result: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN';
      if (r.kind === 'education') {
        const outcomes = education.map((e) => e.graduation && e.graduation.slice(0, 4) > asOf.slice(0, 4) && e.status === 'completed' ? 'UNKNOWN' : degreeGate(e, { level: r.degree ?? 'other', enrollmentAllowed: r.enrollmentAllowed, equivalentAllowed: r.equivalentAllowed }));
        result = outcomes.includes('PASS') ? 'PASS' : outcomes.length && outcomes.every((v) => v === 'FAIL') ? 'FAIL' : 'UNKNOWN';
      } else {
        const certificate = certifications.find((c) => r.excerpt.toLowerCase().includes(c.name.toLowerCase()));
        if (certificate) result = certificate.expires && certificate.expires < asOf ? 'FAIL' : 'PASS';
      }
      if (r.importance === 'required') checks.push({ rule: r.kind, result: config.gates.education ? result : result === 'FAIL' ? 'UNKNOWN' : result, excerpt: r.excerpt, factIds: education.flatMap((e) => e.evidenceIds) });
      return { r, value: result === 'PASS' ? 1 : 0, confidence: result === 'UNKNOWN' ? 0 : avg((r.kind === 'education' ? education : certifications).map(confidenceOf)) * r.confidence };
    });
    for (const r of parsed.items.filter((r) => r.kind === 'graduation' && r.importance === 'required')) {
      const years = education.flatMap((e) => e.graduation ? [Number(e.graduation.slice(0, 4))] : []);
      checks.push({ rule: 'graduation', result: years.some((y) => y >= r.graduationStart! && y <= r.graduationEnd!) ? 'PASS' : years.length ? 'FAIL' : 'UNKNOWN', excerpt: r.excerpt, factIds: education.flatMap((e) => e.evidenceIds) });
    }
    add('education', weighted(educationValues), avg(educationValues.map((v) => v.confidence)), 'Completed degree, explicit enrollment alternatives, or unexpired certification evidence; equivalency is unresolved rather than rejected.');
    // Bounded lexical support only. No applicant name/contact or protected facts enter it.
    const lexical = matches.length ? avg(matches.map((m) => Number(m.strength === 1))) : null;
    add('lexical', lexical, avg(matches.map((m) => m.confidence)), 'Canonical requirement text corroboration; BM25 remains retrieval metadata, not a qualification multiplier.');
    const p = profile.preferences;
    const locationActive = p.locations.length > 0 || p.workModes.length > 0;
    const locationKnown = job.location.length > 0 || job.workMode !== 'unknown';
    const locationPass = (!p.locations.length || p.locations.some((x) => job.location.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase() === 'remote' && job.workMode === 'remote')) && (!p.workModes.length || p.workModes.includes(job.workMode as 'remote' | 'hybrid' | 'onsite'));
    add('location', locationActive && locationKnown ? Number(locationPass) : null, locationKnown ? .95 : 0, 'User-selected location/work mode is a separate preference component.');
    if (config.gates.location && locationActive) checks.push({ rule: 'location', result: !locationKnown ? 'UNKNOWN' : locationPass ? 'PASS' : 'FAIL', excerpt: `${job.location}; ${job.workMode}`, factIds: [] });
    const salaryKnown = p.minimumSalary !== null && job.salary && job.salary.currency === p.currency && /annual|year/i.test(job.salary.interval) && (job.salary.max ?? job.salary.min) !== null;
    const salaryPass = salaryKnown ? (job.salary!.max ?? job.salary!.min!) >= p.minimumSalary! : false;
    add('salary', salaryKnown ? Number(salaryPass) : null, salaryKnown ? .95 : 0, 'Missing currency/period/amount is inactive; no exchange-rate or annualization assumption is invented.');
    if (config.gates.salary && p.minimumSalary !== null) checks.push({ rule: 'salary', result: !salaryKnown ? 'UNKNOWN' : salaryPass ? 'PASS' : 'FAIL', excerpt: job.salary ? JSON.stringify(job.salary) : 'Salary not published', factIds: [] });
    const excludedRole = p.excludedRoles.some((r) => job.title.toLowerCase().includes(r.toLowerCase()));
    if (excludedRole) checks.push({ rule: 'role-exclusion', result: 'FAIL', excerpt: job.title, factIds: [] });
    const companyExcluded = p.excludedCompanies?.some((name) => name.toLowerCase() === job.company.toLowerCase()) ?? false;
    if (companyExcluded) checks.push({ rule: 'company-exclusion', result: 'FAIL', excerpt: job.company, factIds: [] });
    add('company', p.preferredCompanies?.length ? Number(p.preferredCompanies.some((name) => name.toLowerCase() === job.company.toLowerCase())) : null, p.preferredCompanies?.length ? 1 : 0, 'Only explicit company preferences apply; employer prestige is never inferred.');
    if (config.gates.requiredSkills && coverage < config.thresholds.coverage) checks.push({ rule: 'required-skills', result: 'UNKNOWN', excerpt: 'Configured essential-skill coverage lacks verified evidence; missing evidence is not a fabricated absence.', factIds: [] });
    if (config.gates.experience && experienceValues.some((v) => v.value < 1)) checks.push({ rule: 'experience', result: work.length ? 'FAIL' : 'UNKNOWN', excerpt: 'Relevant verified employment does not establish the configured experience gate.', factIds: work.flatMap((w) => w.evidenceIds) });
    const selectedNames = config.method === 'technical-v2' ? ['skills', 'experience', 'projects', 'seniority', 'role', 'depth', 'education', 'lexical'] : ['skills', 'role', 'experience', 'location', 'salary', 'education', 'lexical', 'company'];
    const activeTotal = selectedNames.reduce((sum, name) => sum + (components.get(name)?.value !== null ? config.weights[name as keyof Weights] : 0), 0);
    const details = selectedNames.map((name) => { const c = components.get(name)!; const weight = config.weights[name as keyof Weights]; const activeWeight = c.value !== null && activeTotal ? weight / activeTotal : 0; return { name, ...c, configuredWeight: weight, activeWeight, contribution: 100 * activeWeight * (c.value ?? 0) }; });
    const score = Math.round(details.reduce((sum, c) => sum + c.contribution, 0) * 100) / 100;
    const confidence = rounded(details.reduce((sum, c) => sum + c.activeWeight * c.confidence, 0));
    const prefs = ['location', 'salary'].map((n) => components.get(n)!).filter((c) => c.value !== null);
    const preferenceScore = prefs.length ? Math.round(avg(prefs.map((p) => p.value!)) * 10000) / 100 : null;
    const excluded = checks.some((c) => c.result === 'FAIL');
    const ranking: RankingDetails = { method: config.method, configId: config.id, configRevision: config.revision, configHash, taxonomyVersion: TAXONOMY_VERSION, parserVersion: parsed.parserVersion, evidenceVersion, asOf, technicalScore: config.method === 'technical-v2' ? score : null, preferenceScore, requiredCoverage: coverage, shortlist: !excluded && score >= config.thresholds.score && confidence >= config.thresholds.confidence && coverage >= config.thresholds.coverage, components: details, requirements: matches.map((m) => ({ id: m.r.id, excerpt: m.r.excerpt, importance: m.r.importance, strength: m.strength, evidenceIds: [...m.ids].sort(), explanation: m.reason })) };
    return JobMatchSchema.parse({ job, score, bm25Raw, excluded, review: checks.some((c) => c.result === 'UNKNOWN') || confidence < config.thresholds.confidence || coverage < config.thresholds.coverage || job.duplicateGroup !== null, confidence, checks, matchedSkills: [...new Set(matches.filter((m) => m.strength > 0).map((m) => m.r.skillId!))].sort(), gaps: [...new Set(matches.filter((m) => m.r.importance === 'required' && m.strength < .8).map((m) => m.r.skillId!))].sort(), reasons: details.map((c) => `${c.name}: ${c.value === null ? 'inactive' : `${c.contribution.toFixed(2)} points`}. ${c.explanation}`), features: Object.fromEntries(details.filter((c) => c.value !== null).map((c) => [c.name, c.value!])), profileVersion: profile.version, scorerVersion: 'deterministic-v2', ranking });
  });
  return results.sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.score - a.score || b.confidence - a.confidence || (a.job.id < b.job.id ? -1 : a.job.id > b.job.id ? 1 : 0));
}
