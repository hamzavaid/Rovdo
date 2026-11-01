/** Shared hard constraints: broad lexical retrieval must never become jurisdiction authorization. */
import type { CandidateProfile, EligibilityCheck, Job } from '@rovdo/shared';
const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/u\.s\.(?:a\.)?/g, 'us')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function jurisdiction(raw: string): { country: string; region: string; text: string } {
  const text = norm(raw);
  const country = /\b(?:united states|usa|us)\b/.test(text)
    ? 'US'
    : /\b(?:canada|canadian)\b/.test(text)
      ? 'CA'
      : /\b(?:australia|australian|au)\b/.test(text)
        ? 'AU'
        : /\b(?:united kingdom|uk|britain)\b/.test(text)
          ? 'GB'
          : /\bgermany\b/.test(text)
            ? 'DE'
            : '';
  // CA is both a country code and a state abbreviation. A comma alone is not
  // jurisdiction evidence; accept an explicit US context or a curated city alias.
  const california =
    /\bcalifornia\b/.test(text) ||
    (/(?:^|,)\s*CA\b/.test(raw) &&
      (country === 'US' ||
        /\b(?:san francisco|los angeles|san diego|san jose|sacramento|oakland) ca\b/.test(text)));
  return { text, country: california ? 'US' : country, region: california ? 'US-CA' : '' };
}
export function locationOutcome(job: Job, desired: string[]): EligibilityCheck['result'] {
  if (!desired.length) return 'PASS';
  const locations = (
    job.workMode === 'remote' && job.details?.remoteJurisdiction.length
      ? job.details.remoteJurisdiction
      : [job.location]
  )
    .flatMap((s) => s.split(/;|\||\bor\b/i))
    .map(jurisdiction);
  let unknown = false;
  for (const raw of desired) {
    const want = jurisdiction(raw);
    if (want.text === 'remote') {
      if (job.workMode === 'remote') return 'PASS';
      if (job.workMode === 'unknown') unknown = true;
      continue;
    }
    if (!want.text || want.text === 'ca') {
      unknown = true;
      continue;
    }
    for (const have of locations) {
      if (
        !have.text ||
        have.text === 'ca' ||
        /^(?:remote|hybrid|onsite|unknown)$/.test(have.text)
      ) {
        unknown = true;
        continue;
      }
      if (want.region) {
        if (have.region === want.region) return 'PASS';
        if (!have.region && (!have.country || have.country === want.country)) unknown = true;
      } else if (want.country) {
        if (have.country === want.country) return 'PASS';
        if (!have.country) unknown = true;
      } else if (have.text === want.text || ` ${have.text} `.includes(` ${want.text} `))
        return 'PASS';
      else unknown = true;
    }
  }
  return unknown ? 'UNKNOWN' : 'FAIL';
}
/** Every material legal clause survives even when its expected value cannot safely be interpreted. */
export function legalChecks(text: string, profile: CandidateProfile): EligibilityCheck[] {
  const result: EligibilityCheck[] = [];
  let preferredSection = false;
  const clauses = text.replace(
    /\s+and\s+(?=(?:no\s+)?(?:active|must|citizen|work author|clearance|TS\/SCI|U\.?S\.?\s+citizen|United States\s+citizen))/gi,
    '\n',
  );
  for (const excerpt of clauses.split(
    /[\n;]|\s+but\s+|,\s*(?=(?:active|must|citizen|work)\b)|(?<=[a-z])\.\s+(?=[A-Z])/,
  )) {
    if (/^\s*(?:preferred|nice.to.have)\s+(?:qualifications|requirements)/i.test(excerpt))
      preferredSection = true;
    if (/^\s*(?:required|minimum)\s+(?:qualifications|requirements)/i.test(excerpt))
      preferredSection = false;
    if (preferredSection && !/\brequired|\bmust\b/i.test(excerpt)) continue;
    if (
      /\b(?:no .{0,70}(?:required|necessary|needed)|not (?:required|necessary|needed)|do not require|optional|preferred|a plus)\b/i.test(
        excerpt,
      )
    )
      continue;
    for (const [rule, pattern] of [
      ['citizenship', /\bcitizen(?:ship|s)?\b/i],
      ['workAuthorization', /work authori[sz]|authorized to work/i],
      ['clearance', /clearance|TS\/SCI/i],
      ['returnToSchool', /return to school/i],
      ['sponsorship-review', /visa|sponsor/i],
      [
        'legal-unresolved',
        /\bITAR\b|export.control|\b(?:U\.?S\.?|United States)\s+persons?\b|legal eligib|permanent residen/i,
      ],
    ] as const) {
      if (!pattern.test(excerpt)) continue;
      const facts = profile.facts.filter(
        (f) => f.verified && f.source.kind === 'user' && f.field === rule,
      );
      const values = facts.map((f) => norm(f.value));
      let expected = rule === 'returnToSchool' ? 'yes' : '';
      if (rule === 'citizenship' || rule === 'workAuthorization') {
        const c = jurisdiction(excerpt).country;
        expected = c ? c.toLowerCase() : '';
      } else if (rule === 'clearance')
        expected = /ts\s*\/\s*sci/i.test(excerpt)
          ? 'ts sci'
          : /top secret/i.test(excerpt)
            ? 'top secret'
            : /\bsecret\b/i.test(excerpt)
              ? 'secret'
              : /active/i.test(excerpt)
                ? 'active'
                : '';
      const alternatives = /\bor\b/i.test(excerpt);
      const pass =
        !!expected &&
        values.some((v) => {
          if (/\b(?:no|none|not)\b/.test(v)) return false;
          if (rule === 'citizenship' || rule === 'workAuthorization')
            return jurisdiction(v).country.toLowerCase() === expected;
          return v === expected || (rule === 'clearance' && v === `active ${expected}`);
        });
      const fail =
        !alternatives && values.some((v) => v === 'no' || v === 'none' || v === `${expected} no`);
      result.push({
        rule,
        result: pass && fail ? 'UNKNOWN' : pass ? 'PASS' : fail ? 'FAIL' : 'UNKNOWN',
        excerpt: excerpt.trim().replace(/\.$/, ''),
        factIds: facts.map((f) => f.id),
      });
    }
  }
  return result;
}
