import { randomUUID } from 'node:crypto';
import { GlobalDiscoveryEngine } from '@rovdo/job-discovery';
import { DiscoveryRecordSchema, normalizeDiscoveryJob, plain, sha256 } from '@rovdo/job-sources';
/**
 * Validates career IPC commands and coordinates local profile, job and source operations.
 * Returns a consistent view after mutations while keeping optional AI review separate from discovery.
 */
import { emptyProfile, expandSearch, exportJobs } from '@rovdo/career';
import { CareerCommandSchema, CareerResultSchema, JobSearchSchema } from '@rovdo/shared';
import type { CareerCommand, JobSearch } from '@rovdo/shared';
import type { CareerStore } from '@rovdo/storage';
import { discoverEmployers, refreshEmployers } from '@rovdo/job-discovery';
import type { DiscoveryEngine } from '@rovdo/job-discovery';
import { isTrustedFrame } from './security';

const defaultSearch: JobSearch = {
  query: '',
  company: '',
  workMode: 'all',
  savedOnly: false,
  includeExcluded: false,
};
export function createCareerService(
  store: CareerStore,
  engine: DiscoveryEngine,
  evaluate: (request: Extract<CareerCommand, { op: 'evaluate' }>) => Promise<void>,
  global = new GlobalDiscoveryEngine(store),
  writeExport: (format: 'csv' | 'json', data: string) => Promise<boolean> = async () => false,
) {
  const controller = new AbortController();
  let discovering: Promise<void> | null = null;
  let reviewing = false;
  let pendingReview: Promise<void> | null = null;
  function view(input: JobSearch = defaultSearch) {
    const search = JobSearchSchema.parse(input);
    const profile = store.profile();
    const saved = store.savedIds();
    const sources = store.sources().filter((s) => s.config.collection !== 'global');
    const rows = store.iterateFiltered({ ...search, query: expandSearch(search.query) });
    const config = store
      .rankings()
      .find((p) => p.id === (search.rankingId ?? store.defaultRanking()));
    if (!config) throw new Error('RANKING_NOT_FOUND');
    const candidate = profile ?? emptyProfile();
    const asOf = new Date().toISOString().slice(0, 10);
    const page = store.rankedPage(rows, candidate, config, asOf, search, 200);
    const visible = page.matches;
    const totalJobs = store.jobCount();
    const discovery = global.view();
    return {
      profile,
      sources,
      matches: visible,
      matchedCount: page.total,
      rankingPending: page.pending,
      discovery: {
        ...discovery,
        filtered: discovery.run ? store.discoveryFiltered(discovery.run.id, search) : 0,
      },
      directory: store.directory(),
      rankingProfiles: store.rankings(),
      savedSearches: store.savedSearches(),
      markers: store.markers(),
      comparisons: [] as import('@rovdo/shared').JobMatch[],
      cache: { ...store.cacheStats },
      savedIds: saved,
      reviews: store
        .reviews()
        .filter(
          (r) =>
            r.profileVersion === profile?.version &&
            store.job(r.jobId).contentSha256 === r.contentHash,
        ),
      totalJobs,
      polling: engine.polling,
      outcome: page.total
        ? ('RESULTS' as const)
        : sources.some((s) => s.state.status === 'FAILED_SOURCE')
          ? ('FAILED_SOURCE' as const)
          : !sources.length || sources.every((s) => s.state.status === 'NEVER_POLLED')
            ? ('NOT_POLLED' as const)
            : totalJobs === 0
              ? ('EMPTY_SOURCE' as const)
              : ('ZERO_MATCHES' as const),
    };
  }
  return {
    global,
    async command(
      input: unknown,
      sender: { url: string; isMainFrame: boolean; ownsWindow: boolean },
    ) {
      if (!sender.ownsWindow || !isTrustedFrame(sender.url, sender.isMainFrame))
        return CareerResultSchema.parse({ ok: false, code: 'IPC_FORBIDDEN' });
      const parsed = CareerCommandSchema.safeParse(input);
      if (!parsed.success) return CareerResultSchema.parse({ ok: false, code: 'VALIDATION_ERROR' });
      const cmd = parsed.data;
      try {
        if (cmd.op === 'exportJobs') {
          const current = view(cmd.search);
          const output = exportJobs(current.matches, cmd.format);
          const saved = await writeExport(cmd.format, output.data);
          return CareerResultSchema.parse({
            ok: true,
            view: current,
            exported: { saved, skipped: output.skipped },
          });
        }
        if (cmd.op === 'saveProfile') store.saveProfile(cmd.profile);
        if (cmd.op === 'proposeFacts') store.proposeFacts(cmd.facts);
        if (cmd.op === 'startDiscovery') {
          global.start(cmd.options);
          void global.tick().catch(() => {});
        }
        if (cmd.op === 'controlDiscovery') await global.control(cmd.id, cmd.action);
        if (cmd.op === 'pollCompany') {
          const source = store
            .sources()
            .find((s) => s.config.id === cmd.id && s.config.collection !== 'global');
          if (!source) throw new Error('SOURCE_NOT_FOUND');
          if (source.config.enabled) void engine.poll(cmd.id).catch(() => {});
        }
        if (cmd.op === 'saveSource') {
          if (cmd.source.collection === 'global') throw new Error('GLOBAL_SOURCE_READ_ONLY');
          if (cmd.source.ats === 'jsonld' && !store.directoryAllowed(cmd.source))
            throw new Error('SOURCE_NOT_APPROVED');
          store.saveSource(cmd.source);
        }
        if (cmd.op === 'deleteSource') store.deleteSource(cmd.id);
        if (cmd.op === 'searchAll' || cmd.op === 'searchSavedCompanies') {
          if (discovering) throw new Error('BUSY');
          discovering = refreshEmployers(store, controller.signal);
          try {
            await discovering;
          } finally {
            discovering = null;
          }
          store.enableDirectory();
          void engine.pollAll().catch(() => {});
        }
        if (cmd.op === 'discoverFeeds') {
          if (discovering) throw new Error('BUSY');
          discovering = discoverEmployers(store, cmd, controller.signal);
          try {
            await discovering;
          } finally {
            discovering = null;
          }
        }
        if (cmd.op === 'importDiscovery') {
          const id = cmd.runId ?? randomUUID();
          let run;
          try {
            run = store.global.run(id);
            if (!run.options.sourceIds.includes('jobspy-import'))
              throw new Error('INVALID_IMPORT_RUN');
          } catch (error) {
            if (error instanceof Error && error.message === 'INVALID_IMPORT_RUN') throw error;
            run = {
              id,
              status: 'completed' as const,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              profileVersion: store.profile()?.version ?? null,
              queries: [],
              options: { sourceIds: ['jobspy-import'], overrides: {} },
              reason: 'Imported rows remain unverified; no source websites were scraped.',
            };
            store.global.saveRun(run);
          }
          const source = store.globalSource(
            'jobspy-import',
            'Imported JobSpy results',
            'https://github.com/speedyapply/JobSpy',
          );
          const jobs = [];
          let rejected = 0;
          for (const raw of cmd.rows) {
            try {
              const str = (key: string) => (typeof raw[key] === 'string' ? String(raw[key]) : '');
              const numeric = (value: unknown) =>
                typeof value === 'number' && Number.isFinite(value)
                  ? value
                  : typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
                    ? Number(value)
                    : null;
              const min = numeric(raw.min_amount),
                max = numeric(raw.max_amount);
              const record = DiscoveryRecordSchema.parse({
                url: str('job_url_direct') || str('job_url'),
                title: str('title'),
                company: str('company') || null,
                location: str('location'),
                description: plain(str('description')),
                postedAt: Number.isFinite(Date.parse(str('date_posted')))
                  ? new Date(str('date_posted')).toISOString()
                  : null,
                employmentType: str('job_type') || 'unknown',
                workMode:
                  raw.is_remote === true || str('is_remote').toLowerCase() === 'true'
                    ? 'remote'
                    : 'unknown',
                salary:
                  (min !== null || max !== null) && str('currency')
                    ? {
                        min,
                        max,
                        currency: str('currency'),
                        interval: str('interval'),
                        source: 'explicit',
                      }
                    : null,
                sourceId: 'jobspy-import',
                sourceName: 'Imported JobSpy results',
                sourceUrl: 'https://github.com/speedyapply/JobSpy',
                kind: 'import',
              });
              const job = normalizeDiscoveryJob(record, source, id, Date.now());
              if (job) jobs.push(job);
              else
                store.global.saveListing({
                  id: sha256(id + record.url),
                  runId: id,
                  sourceId: 'jobspy-import',
                  url: record.url,
                  title: record.title,
                  company: record.company,
                  location: record.location,
                  description: record.description,
                  status: 'incomplete',
                  reason: 'Missing company or full description; not scored.',
                });
            } catch {
              rejected++;
            }
          }
          store.ingestDiscovered(id, source, jobs);
          store.global.note(id, 'jobspy-import', 'imported', jobs.length, rejected);
        }
        if (cmd.op === 'saveSearch') store.saveSearch(cmd.name, cmd.search);
        if (cmd.op === 'deleteSearch') store.deleteSearch(cmd.id);
        if (cmd.op === 'markJob')
          store.markJob(cmd.jobId, {
            ...(cmd.applied !== undefined ? { applied: cmd.applied } : {}),
            ...(cmd.feedback ? { feedback: cmd.feedback } : {}),
            ...(cmd.seen ? { seenAt: Date.now() } : {}),
          });
        if (cmd.op === 'saveJob') store.saveJob(cmd.jobId, cmd.saved);
        if (cmd.op === 'poll') void engine.pollAll().catch(() => {});
        if (cmd.op === 'evaluate') {
          if (reviewing) throw new Error('BUSY');
          reviewing = true;
          try {
            pendingReview = evaluate(cmd);
            await pendingReview;
          } finally {
            reviewing = false;
            pendingReview = null;
          }
        }
        const current = view(cmd.op === 'view' ? cmd.search : defaultSearch);
        if (cmd.op === 'compare') {
          const job = store.job(cmd.jobId);
          current.comparisons = cmd.rankingIds.map((id) => {
            const config = store.rankings().find((p) => p.id === id);
            if (!config) throw new Error('RANKING_NOT_FOUND');
            return store.cachedRanking(
              { job, bm25Raw: 0 },
              store.profile() ?? emptyProfile(),
              config,
              new Date().toISOString().slice(0, 10),
            );
          });
        }
        return CareerResultSchema.parse({ ok: true, view: current });
      } catch {
        return CareerResultSchema.parse({
          ok: false,
          code: cmd.op === 'evaluate' ? 'AI_REVIEW_FAILED' : 'CAREER_ERROR',
        });
      }
    },
    async shutdown() {
      controller.abort();
      await Promise.all([
        pendingReview?.catch(() => {}),
        discovering?.catch(() => {}),
        global.shutdown(),
      ]);
    },
  };
}
