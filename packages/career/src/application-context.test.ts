import { ApprovedApplicationContextSchema, sha256Text, contentHash } from '@rovdo/shared';
import { expect, it } from 'vitest';
import {
  buildApprovedApplicationContext,
  validateApprovedApplicationContext,
} from './application-context';
import { sampleCandidate, sampleJob } from '../../../tests/fixtures/ranking-v2';
import { BUILTIN_RANKINGS } from './scorer-v2';
const request = async () => {
  const input = {
    profile: sampleCandidate(),
    job: sampleJob(),
    ranking: BUILTIN_RANKINGS[1]!,
    template: { id: 'resume-default', version: '1', contentSha256: 'f'.repeat(64) },
    approval: {
      approvedAt: '2026-10-20T00:00:00.000Z',
      factIds: [] as string[],
      qualificationIds: ['skills:typescript', 'experience:work', 'education:degree'],
    },
  };
  for (const e of input.profile.intelligence!.evidence) e.sha256 = await sha256Text(e.excerpt);
  return input;
};
it('builds a reproducible local snapshot with approved evidence, version hashes and no generation', async () => {
  const input = await request();
  const a = await buildApprovedApplicationContext(input),
    b = await buildApprovedApplicationContext(input);
  expect(a).toEqual(b);
  expect(a.contractVersion).toBe('approved-application-v1');
  expect(a.candidate.qualifications.skills).toHaveLength(1);
  expect(a.claims.every((c) => c.evidenceIds.length > 0)).toBe(true);
  expect(await validateApprovedApplicationContext(a)).toEqual(a);
  expect(a.versions.profileVersion).toBe(input.profile.version);
});
it('omits unverified/unsupported and conflicting qualifications, contacts and protected facts by default', async () => {
  const input = await request();
  input.profile.intelligence!.skills[0]!.verified = false;
  input.profile.facts.push({
    id: 'email',
    field: 'email',
    value: 'private@example.com',
    verified: true,
    source: { kind: 'user', reference: 'Contact', capturedAt: input.approval.approvedAt },
  });
  const c = await buildApprovedApplicationContext(input);
  expect(c.candidate.qualifications.skills).toHaveLength(0);
  expect(JSON.stringify(c)).not.toContain('private@example.com');
  expect(c.omitted.some((x) => x.id === 'skills:typescript')).toBe(true);
});
it('rejects modified snapshots, dangling claims, stale hashes, and unapproved additions', async () => {
  const context = await buildApprovedApplicationContext(await request());
  const changed = structuredClone(context);
  changed.job.title = 'Tampered';
  await expect(validateApprovedApplicationContext(changed)).rejects.toThrow();
  const dangling = structuredClone(context);
  dangling.claims[0]!.evidenceIds = ['missing'];
  await expect(validateApprovedApplicationContext(dangling)).rejects.toThrow();
  const added = structuredClone(context);
  added.candidate.qualifications.skills.push(sampleCandidate().intelligence!.skills[1]!);
  await expect(validateApprovedApplicationContext(added)).rejects.toThrow();
});
it('selects legacy facts through explicit approvals with verifiable evidence rather than fabricating structured records', async () => {
  const input = await request();
  input.profile.facts.push({
    id: 'old-work',
    field: 'experience',
    value: 'Assisted firmware integration',
    verified: true,
    source: {
      kind: 'user',
      reference: 'Explicit assertion',
      capturedAt: input.approval.approvedAt,
    },
  });
  input.approval.factIds = ['old-work'];
  const c = await buildApprovedApplicationContext(input);
  expect(c.candidate.facts[0]!.value).toBe('Assisted firmware integration');
  expect(c.claims.some((c) => c.subject === 'fact:old-work')).toBe(true);
  expect(c.candidate.qualifications.experience).toHaveLength(1);
});

it('does not launder altered evidence hashes into approved claims', async () => {
  const input = await request();
  input.profile.intelligence!.evidence[0]!.excerpt = 'Altered evidence';
  const context = await buildApprovedApplicationContext(input);
  expect(context.claims).toHaveLength(0);
  expect(context.omitted).toHaveLength(3);
});

it('omits conflicting verified qualifications even when explicitly selected', async () => {
  const input = await request();
  input.profile.intelligence!.experience.push({
    ...input.profile.intelligence!.experience[0]!,
    id: 'other-work',
    end: '2024-12',
  });
  input.approval.qualificationIds = ['experience:work', 'experience:other-work'];
  const c = await buildApprovedApplicationContext(input);
  expect(c.candidate.qualifications.experience).toHaveLength(0);
  expect(c.omitted).toEqual([
    { id: 'experience:work', reason: 'conflicting' },
    { id: 'experience:other-work', reason: 'conflicting' },
  ]);
});
it('rejects duplicate approved fact bindings and duplicate approval identifiers', async () => {
  const input = await request();
  input.profile.facts.push({
    id: 'contact',
    field: 'email',
    value: 'anon@example.com',
    verified: true,
    source: { kind: 'user', reference: 'Contact', capturedAt: input.approval.approvedAt },
  });
  input.approval.factIds = ['contact'];
  const c = await buildApprovedApplicationContext(input);
  const repeated = structuredClone(c);
  repeated.candidate.facts.push(repeated.candidate.facts[0]!);
  expect(ApprovedApplicationContextSchema.safeParse(repeated).success).toBe(false);
  await expect(validateApprovedApplicationContext(repeated)).rejects.toThrow();
  input.approval.factIds = ['contact', 'contact'];
  await expect(buildApprovedApplicationContext(input)).rejects.toThrow();
});

it('keeps long fact identities collision-safe and binds current legal decisions and job identity', async () => {
  const input = await request();
  const ids = ['a', 'b'].map((suffix) => 'x'.repeat(160) + suffix);
  for (const [i, id] of ids.entries())
    input.profile.facts.push({
      id,
      field: 'project',
      value: `Verified project ${i}`,
      verified: true,
      source: {
        kind: 'user',
        reference: 'Explicit approval',
        capturedAt: input.approval.approvedAt,
      },
    });
  input.approval.factIds = ids;
  input.job.descriptionText = 'TypeScript required. Must comply with ITAR export restrictions.';
  const a = await buildApprovedApplicationContext(input);
  expect(new Set(a.candidate.facts.flatMap((f) => f.evidenceIds)).size).toBe(2);
  expect(a.decision?.eligibility).toBe('UNKNOWN');
  expect(a.decision?.checks.some((c) => c.result === 'UNKNOWN')).toBe(true);
  await expect(validateApprovedApplicationContext(a)).resolves.toEqual(a);
  input.job.id += ':merged';
  input.job.canonicalUrl += '/canonical';
  const b = await buildApprovedApplicationContext(input);
  expect(b.hashes.job).not.toBe(a.hashes.job);
  expect(b.hashes.context).not.toBe(a.hashes.context);
  input.ranking = { ...input.ranking, thresholds: { ...input.ranking.thresholds, score: 81 } };
  expect((await buildApprovedApplicationContext(input)).hashes.ranking).not.toBe(b.hashes.ranking);
  const c = await buildApprovedApplicationContext(input);
  input.profile.intelligence!.evidence[0]!.excerpt += ' Additional approved evidence.';
  input.profile.intelligence!.evidence[0]!.sha256 = await sha256Text(
    input.profile.intelligence!.evidence[0]!.excerpt,
  );
  const d = await buildApprovedApplicationContext(input);
  expect(d.hashes.candidate).not.toBe(c.hashes.candidate);
  expect(d.hashes.context).not.toBe(c.hashes.context);
});
it('keeps historical v1 snapshots without a decision readable without upgrading their stored content', async () => {
  const current = await buildApprovedApplicationContext(await request());
  const { decision: capturedDecision, hashes, ...historicalBody } = current;
  const { context: capturedDigest, ...parts } = hashes;
  expect(capturedDecision).toBeDefined();
  expect(capturedDigest).toHaveLength(64);
  const historical = {
    ...historicalBody,
    hashes: { ...parts, context: await contentHash({ ...historicalBody, hashes: parts }) },
  };
  expect((await validateApprovedApplicationContext(historical)).decision).toBeUndefined();
  expect(current.decision).toBeDefined();
});
