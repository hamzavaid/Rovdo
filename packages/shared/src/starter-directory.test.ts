import { describe, expect, it } from 'vitest';
import { StarterDirectoryManifestSchema } from './index';

function manifest() {
  return {
    version: 1,
    releasedAt: '2026-11-11T00:00:00Z',
    employers: [
      {
        id: 'synthetic-industrial',
        name: 'Synthetic Industrial Company',
        aliases: ['Synthetic Industry'],
        categories: ['manufacturing', 'engineering', 'finance'],
        referenceSets: [
          { id: 'fortune-500', edition: '2026' },
          { id: 'nasdaq-100', edition: '2026-11' },
          { id: 'forbes-global-2000', edition: '2026' },
          { id: 'broader', edition: '2026-11' },
        ],
        boards: [
          { url: 'https://jobs.lever.co/synthetic-industrial', adapter: 'lever' },
          { url: 'https://careers.example/industrial', adapter: 'unsupported' },
        ],
        provenance: [{ url: 'https://reference.example/list', checkedAt: '2026-11-10T00:00:00Z' }],
      },
    ],
  };
}

describe('release starter directory manifest', () => {
  it('retains cross-list membership, descriptive categories and unsupported coverage gaps', () => {
    const input = manifest();
    expect(StarterDirectoryManifestSchema.parse(input)).toEqual(input);
  });

  it.each(['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jsonld', 'workday', 'unsupported'])(
    'represents an employer using the declared board adapter %s',
    (adapter) => {
      const input = manifest();
      input.employers[0]!.boards[0]!.adapter = adapter;
      expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(true);
    },
  );

  it('rejects duplicate employer identities even with different board URLs', () => {
    const input = manifest();
    input.employers.push({
      ...input.employers[0]!,
      boards: [{ url: 'https://jobs.lever.co/another-company', adapter: 'lever' }],
    });
    expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
  });

  it('rejects the same canonical board URL across distinct employer identities', () => {
    const input = manifest();
    input.employers.push({
      ...input.employers[0]!,
      id: 'another-employer',
      boards: [{ url: 'https://JOBS.LEVER.CO/synthetic-industrial', adapter: 'lever' }],
    });
    expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a duplicate board within one employer', () => {
    const input = manifest();
    input.employers[0]!.boards.push({ ...input.employers[0]!.boards[0]! });
    expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
  });

  it.each(['http://careers.example/jobs', 'javascript:alert(1)', 'not a URL'])(
    'rejects a non-HTTPS board URL: %s',
    (url) => {
      const input = manifest();
      input.employers[0]!.boards[0]!.url = url;
      expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
    },
  );

  it('rejects insecure provenance independently of board URL validity', () => {
    const input = manifest();
    input.employers[0]!.provenance[0]!.url = 'http://reference.example/list';
    expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
  });

  it.each([{ version: 2 }, { releasedAt: 'yesterday' }, { runtimeVerified: true }])(
    'rejects invalid release metadata or implicit verification claims: %j',
    (override) => {
      expect(StarterDirectoryManifestSchema.safeParse({ ...manifest(), ...override }).success).toBe(
        false,
      );
    },
  );

  it('does not accept reference-list membership as a runtime approval field', () => {
    const input = manifest();
    expect(
      StarterDirectoryManifestSchema.safeParse({
        ...input,
        employers: [{ ...input.employers[0], policy: 'approved' }],
      }).success,
    ).toBe(false);
  });

  it.each(['id', 'name'] as const)('rejects an empty employer %s', (field) => {
    const input = manifest();
    input.employers[0]![field] = '';
    expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid provenance dates', () => {
    const input = manifest();
    input.employers[0]!.provenance[0]!.checkedAt = '2026-99-99';
    expect(StarterDirectoryManifestSchema.safeParse(input).success).toBe(false);
  });
});
