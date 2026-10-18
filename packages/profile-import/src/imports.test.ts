import { describe, expect, it } from 'vitest';
import { extractFileText, previewText, mergeReviewed, githubPreview } from './index';
import { sampleCandidate } from '../../../tests/fixtures/ranking-v2';
const at = '2026-10-17T00:00:00.000Z';
describe('deterministic imports and review', () => {
  it.each(['txt', 'md'])('extracts %s facts as unverified, with source provenance and no protected attributes', async (format) => {
    const text = await extractFileText(format, Buffer.from('Skills\nTypeScript, Node.js\nEducation\nExpected Bachelor of Science in Computer Science May 2027\nExperience\nBackend Engineer | Fixture | Jan 2022 - Dec 2025\nTypeScript and Node.js production services\nCitizenship: US\nGender: private\nDate of birth: 2000-01-01'));
    const draft = previewText(text, 'resume.' + format, 'file', at);
    expect(draft.intelligence.skills.some((s) => s.skillId === 'typescript')).toBe(true);
    expect(draft.intelligence.skills.every((s) => !s.verified)).toBe(true);
    expect(draft.intelligence.education[0]!.status).toBe('expected');
    expect(draft.intelligence.experience[0]!.start).toBe('2022-01');
    expect(draft.facts.every((f) => !f.verified)).toBe(true);
    expect(JSON.stringify(draft.intelligence)).not.toContain('Gender');
    expect(draft.source.sha256).toHaveLength(64);
  });
  it('accepts JSON profiles, keeps legal assertions unconfirmed and deduplicates verified records', async () => {
    const candidate = sampleCandidate();
    const text = await extractFileText('json', Buffer.from(JSON.stringify(candidate)));
    const draft = previewText(text, 'profile.json', 'file', at, 'json');
    const merged = mergeReviewed(candidate, draft, draft.intelligence.skills.map((s) => s.id), false);
    expect(merged.intelligence!.skills).toHaveLength(candidate.intelligence!.skills.length);
    expect(merged.intelligence!.skills.find((s) => s.skillId === 'typescript')!.depth).toBe('production');
    expect(candidate.version).toBe(1); expect(merged.version).toBe(2);
  });
  it('does not turn bulk verification into legal/clearance confirmation', () => {
    const draft = previewText('Skills\nPython\nCitizenship: US\nWork authorization: US\nClearance: active', 'pasted LinkedIn', 'linkedin', at);
    const ids = [...draft.facts.map((f) => f.id), ...draft.intelligence.skills.map((s) => s.id)];
    const noConsent = mergeReviewed(sampleCandidate(), draft, ids, false);
    expect(noConsent.facts.filter((f) => ['citizenship', 'workAuthorization', 'clearance'].includes(f.field)).every((f) => !f.verified)).toBe(true);
    const confirmed = mergeReviewed(sampleCandidate(), draft, ids, true);
    expect(confirmed.facts.filter((f) => ['citizenship', 'workAuthorization', 'clearance'].includes(f.field)).every((f) => f.verified && f.source.kind === 'user')).toBe(true);
  });
  it('namespaces imported evidence and qualification versions instead of colliding with verified originals', () => {
    const candidate = sampleCandidate(['react']); candidate.intelligence!.skills[0]!.version = '17';
    const draft = previewText('Skills\nReact 18', 'new.md', 'file', at);
    const result = mergeReviewed(candidate, draft, draft.intelligence.skills.map((s) => s.id), false);
    expect(result.intelligence!.skills.filter((s) => s.skillId === 'react')).toHaveLength(2);
    expect(new Set(result.intelligence!.skills.map((s) => s.id)).size).toBe(2);
  });
  it('rebinds JSON IDs and upgrades only explicitly reviewed unverified duplicates', () => {
    const original = sampleCandidate(['react']);
    const changed = structuredClone(original.intelligence!); changed.skills[0]!.version = '19'; changed.evidence[0]!.excerpt = 'New React 19 evidence';
    const draft = previewText(JSON.stringify(changed), 'new.json', 'file', at, 'json');
    expect(draft.intelligence.evidence[0]!.id).not.toBe(original.intelligence!.evidence[0]!.id);
    const merged = mergeReviewed(original, draft, draft.intelligence.skills.map((s) => s.id), false);
    expect(merged.intelligence!.skills.find((s) => s.version === '19')!.evidenceIds).toEqual(draft.intelligence.skills[0]!.evidenceIds);
    const pending = sampleCandidate(['react']); pending.intelligence!.skills[0]!.verified = false;
    const review = previewText('Skills\nReact', 'review.txt', 'file', at);
    expect(mergeReviewed(pending, review, review.intelligence.skills.map((s) => s.id), false).intelligence!.skills[0]!.verified).toBe(true);
  });
  it('uses only fixed public GitHub REST routes and treats metadata as proposed evidence, not authorship', async () => {
    const urls: string[] = [];
    const draft = await githubPreview('fixture-user', 1, at, async (url) => {
      urls.push(url);
      const data = url.includes('/languages') ? { TypeScript: 4000, JavaScript: 1000 } : url.includes('/readme') ? { content: Buffer.from('# A project\nUses TypeScript and Node.js').toString('base64'), encoding: 'base64' } : [{ name: 'project', owner: { login: 'fixture-user' }, private: false, fork: true, html_url: 'https://github.com/fixture-user/project', description: 'A public project', stargazers_count: 3, topics: ['typescript'] }];
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(data)) };
    });
    expect(urls).toHaveLength(3); expect(urls.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
    expect(draft.intelligence.projects[0]!.verified).toBe(false); expect(draft.intelligence.projects[0]!.metadata?.fork).toBe(true);
    await expect(githubPreview('http://localhost', 1, at, async () => { throw new Error('must not fetch'); })).rejects.toThrow();
  });
});

