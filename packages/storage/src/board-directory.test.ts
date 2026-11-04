import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

it('converges historical case-variant inventory identities without losing verification or opt-outs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rovdo-board-case-')),
    file = join(dir, 'career.sqlite');
  let store = new CareerStore(file);
  try {
    const feed = { ats: 'lever', tenant: 'fixture', region: 'global' };
    store.global.rememberCompany(feed, 'Fixture', 'https://jobs.lever.co/fixture', 100);
    store.global.validateCompany(feed, 200);
    store.global.setBoardEnabled('lever:fixture:global', false);
    store.close();
    const db = new DatabaseSync(file);
    db.prepare(
      "INSERT INTO company_inventory VALUES('lever:Fixture:global','lever','Fixture','global','Fixture','https://jobs.lever.co/Fixture',50,300,250)",
    ).run();
    db.prepare("DELETE FROM career_setting WHERE key='canonical-board-identities-v1'").run();
    db.close();
    store = new CareerStore(file);
    expect(store.global.companyPage({}).total).toBe(1);
    expect(store.global.board('lever:fixture:global')).toMatchObject({
      enabled: false,
      discoveredAt: 50,
      validatedAt: 250,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rolls verification and its directory projection back together on an interrupted write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rovdo-board-rollback-'));
  const file = join(dir, 'career.sqlite');
  const store = new CareerStore(file);
  const inspection = new DatabaseSync(file);
  const feed = { ats: 'lever', tenant: 'rollback', region: 'global' };
  try {
    store.global.rememberCompany(feed, 'Rollback fixture', 'https://jobs.lever.co/rollback', 100);
    inspection.exec(
      "CREATE TRIGGER fail_directory BEFORE INSERT ON employer_directory BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;",
    );
    expect(() => store.global.validateCompany(feed, 200)).toThrow('fixture rollback');
    expect(store.global.board('lever:rollback:global')?.validatedAt).toBeNull();
    expect(store.directory()).toHaveLength(0);
    inspection.exec('DROP TRIGGER fail_directory');
    store.global.validateCompany(feed, 300);
    expect(store.directory()).toHaveLength(1);
  } finally {
    inspection.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('atomically projects verified empty boards, retains opt-outs and survives restart without a poll grant', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rovdo-board-'));
  const file = join(dir, 'career.sqlite');
  let store = new CareerStore(file);
  const feed = { ats: 'lever', tenant: 'Example', region: 'global' };
  try {
    store.global.rememberCompany(feed, 'Example Employer', 'https://jobs.lever.co/Example', 100);
    store.global.validateCompany(feed, 200, { contentHash: 'a'.repeat(64), complete: true });
    expect(store.directory()).toHaveLength(1);
    expect(store.directory()[0]).toMatchObject({ company: 'Example Employer', policy: 'review' });
    expect(store.sources()).toHaveLength(0);
    store.global.setBoardEnabled('lever:example:global', false);
    store.close();
    store = new CareerStore(file);
    store.global.rememberCompany(
      { ...feed, tenant: 'example' },
      'Example Employer',
      'https://jobs.lever.co/example',
      300,
    );
    store.global.validateCompany(feed, 400, { contentHash: 'b'.repeat(64), complete: true });
    expect(store.directory()).toHaveLength(1);
    expect(store.global.board('lever:example:global')).toMatchObject({
      enabled: false,
      validatedAt: 400,
      contentHash: 'b'.repeat(64),
    });
    expect(store.global.companyAllowed(feed)).toBe(false);
    expect(store.sources()).toHaveLength(0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('retains a technically valid board with an unresolved employer name without inventing identity', () => {
  const store = new CareerStore(':memory:');
  const feed = { ats: 'ashby', tenant: 'pending', region: 'global' };
  try {
    store.global.rememberCompany(feed, '', 'https://jobs.ashbyhq.com/pending', 100);
    store.global.validateCompany(feed, 200, { contentHash: 'a'.repeat(64), complete: true });
    expect(store.global.board('ashby:pending:global')).toMatchObject({
      nameStatus: 'pending',
      validatedAt: 200,
    });
    expect(store.directory()[0]).toMatchObject({
      company: '',
      nameStatus: 'pending',
      policy: 'review',
    });
    expect(store.sources()).toHaveLength(0);
  } finally {
    store.close();
  }
});
