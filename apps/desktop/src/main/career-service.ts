import {
  GlobalDiscoveryEngine,
  CompanyDiscoveryScheduler,
  inferCollectionScope,
} from '@rovdo/job-discovery';
import { canonicalUrl } from '@rovdo/job-sources';
/**
 * Validates career IPC commands and coordinates local profile, job and source operations.
 * Returns a consistent view after mutations while keeping optional AI review separate from discovery.
 */
import {
  emptyProfile,
  expandSearch,
  exportJobs,
  fingerprint,
  SCORING_POLICY_VERSION,
} from '@rovdo/career';
import {
  CareerCommandSchema,
  CareerResultSchema,
  JobSearchSchema,
  JOB_SOURCE_IDS,
} from '@rovdo/shared';
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
  openJob: (url: string) => Promise<void> = async () => {
    throw new Error('OPEN_UNAVAILABLE');
  },
) {
  const companies = new CompanyDiscoveryScheduler(store, {
    suspended: () => engine.polling,
    automaticStart: () => process.env.ROVDO_OFFLINE_FIXTURES !== '1',
  });
  const controller = new AbortController();
  let discovering: Promise<void> | null = null;
  let reviewing = false;
  let pendingReview: Promise<void> | null = null;
  async function readView(input: JobSearch = defaultSearch, summary = false) {
    const search = JobSearchSchema.parse(input);
    const profile = store.profile();
    const inferred = inferCollectionScope(profile);
    if (!store.collectionScope() && inferred) store.saveCollectionScope(inferred);
    const saved = store.savedIds();
    const sources = store.sources().filter((s) => s.config.collection !== 'global');

    const config = store
      .rankings()
      .find((p) => p.id === (search.rankingId ?? store.defaultRanking()));
    if (!config) throw new Error('RANKING_NOT_FOUND');
    const candidate = profile ?? emptyProfile();
    const asOf = new Date().toISOString().slice(0, 10);
    const jobRun = global.view().run;
    const hadRanking = jobRun
      ? store.global.events(jobRun.id).some((e) => e.stage === 'rank' && e.status === 'complete')
      : false;
    const missesBefore = store.cacheStats.misses;
    if (!summary && jobRun && !hadRanking && store.jobCount() > 0) {
      store.global.event(jobRun.id, 'eligibility', 'running');
      store.global.event(jobRun.id, 'rank', 'running');
    }
    if (!summary) await store.refreshSearchMetadata();
    const page = summary
      ? { matches: [], total: 0, pending: 0 }
      : await store.rankedPageAsync(
          store.iterateFiltered({ ...search, query: expandSearch(search.query) }),
          candidate,
          config,
          asOf,
          search,
          200,
          true,
        );
    const visible = page.matches;
    if (
      !summary &&
      jobRun &&
      (store.cacheStats.misses > missesBefore || (!hadRanking && store.jobCount() > 0))
    ) {
      store.global.event(
        jobRun.id,
        'eligibility',
        page.pending ? 'partial' : 'complete',
        page.total,
      );
      store.global.event(jobRun.id, 'rank', page.pending ? 'partial' : 'complete', page.total);
    }
    const totalJobs = store.jobCount();
    const discovery = global.view();
    const choices = store.rankingJobChoices();
    return {
      collectionScope: store.collectionScope(),
      collectionScopePromptDismissed:
        store.setting('collection-country-prompt-dismissed') === 'true',
      rankingJobs: choices.rows,
      rankingJobTotal: choices.total,
      ...(store.setting('job-collection-defaults-v1')
        ? { collectionDefaults: JSON.parse(store.setting('job-collection-defaults-v1')!) }
        : {}),
      companyDiscovery: companies.engine.view(),
      companyPage: store.global.companyPage(),
      starterDirectoryPage: store.starterDirectoryPage({}),
      automaticCompanyDiscovery: store.setting('automatic-company-discovery') !== 'false',
      requests: [] as ReturnType<typeof store.global.requests>['rows'],
      requestTotal: 0,
      profile,
      sources,
      matches: visible,
      matchedCount: page.total,
      rankingPending: page.pending,
      discovery: {
        ...discovery,
        filtered: !summary && discovery.run ? store.discoveryFiltered(discovery.run.id, search) : 0,
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
            r.rankingHash === fingerprint(config) &&
            r.asOf === asOf &&
            r.scorerVersion ===
              (config.method === 'legacy-v1' ? 'deterministic-v1' : SCORING_POLICY_VERSION) &&
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
  let viewQueue: Promise<void> = Promise.resolve();
  async function view(input: JobSearch = defaultSearch, summary = false) {
    if (summary) return readView(input, true);
    const previous = viewQueue;
    let release!: () => void;
    viewQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await readView(input);
    } finally {
      release();
    }
  }
  return {
    global,
    companies,
    async tick() {
      const inferred = inferCollectionScope(store.profile());
      if (!store.collectionScope() && inferred) store.saveCollectionScope(inferred);
      const scope = store.collectionScope();
      if (scope && process.env.ROVDO_OFFLINE_FIXTURES !== '1') {
        const latest = global.view().run;
        const changed = latest?.collectionScope?.revision !== scope.revision;
        if (
          (!latest ||
            changed ||
            (latest.status === 'completed' && latest.updatedAt + 3600000 <= Date.now())) &&
          latest?.status !== 'canceled'
        ) {
          const defaults = JSON.parse(store.setting('job-collection-defaults-v1') ?? 'null');
          const options = defaults?.options ?? { sourceIds: [...JOB_SOURCE_IDS], overrides: {} };
          if (options.sourceIds.length) global.start(options);
        }
      }
      // Explicitly started work advances even when fixture mode disables automatic startup.
      await global.tick();
      await companies.tick();
    },
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
        if (cmd.op === 'dismissCollectionScopePrompt')
          store.setting('collection-country-prompt-dismissed', 'true');
        if (cmd.op === 'saveCollectionScope') {
          store.saveCollectionScope({ ...cmd.scope, origin: 'user' });
        }
        if (cmd.op === 'collectionSettings') {
          if (
            cmd.options.sourceIds.some((id) => !(JOB_SOURCE_IDS as readonly string[]).includes(id))
          )
            throw new Error('UNKNOWN_SOURCE');
          store.setting(
            'job-collection-defaults-v1',
            JSON.stringify({ scope: cmd.scope, options: cmd.options }),
          );
        }
        if (cmd.op === 'companyDiscovery') {
          if (cmd.action === 'automatic') {
            if (cmd.enabled === undefined) throw new Error('ENABLED_REQUIRED');
            store.setting('automatic-company-discovery', String(cmd.enabled));
            const active = companies.engine.view().run;
            if (!cmd.enabled && active?.status === 'running')
              await companies.control(active.id, 'pause');
          } else if (cmd.action === 'start') {
            companies.start();
            void companies.engine.tick().catch(() => {});
          } else {
            const run = companies.engine.view().run;
            if (!run) throw new Error('RUN_NOT_FOUND');
            await companies.control(run.id, cmd.action);
          }
        }
        if (cmd.op === 'companyBoard') {
          if (cmd.action === 'test') {
            companies.engine.testBoard(cmd.identity);
            void companies.engine.tick().catch(() => {});
          } else store.global.configureBoard(cmd.identity, cmd.action, cmd.intervalMs);
        }
        if (cmd.op === 'queryPlan')
          store.setting('discovery-query-plan-v1', JSON.stringify(cmd.queries));
        if (cmd.op === 'openJob') {
          const job = store.job(cmd.jobId);
          const url = job.canonicalUrl;
          canonicalUrl(url);
          if (new URL(url).port) throw new Error('INVALID_JOB_URL');
          await openJob(url);
        }
        if (cmd.op === 'exportJobs') {
          const current = await view(cmd.search);
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
        if (cmd.op === 'saveSearch') store.saveSearch(cmd.name, cmd.search);
        if (cmd.op === 'deleteSearch') store.deleteSearch(cmd.id);
        if (cmd.op === 'markJob')
          store.markJob(cmd.jobId, {
            ...(cmd.notes !== undefined ? { notes: cmd.notes } : {}),
            ...(cmd.applicationStatus !== undefined
              ? {
                  applicationStatus: cmd.applicationStatus,
                  applied: cmd.applicationStatus !== 'not-applied',
                }
              : {}),
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
        const current = await view(
          cmd.op === 'view' ? cmd.search : defaultSearch,
          cmd.op !== 'view' || cmd.summary === true,
        );
        if (cmd.op === 'companyPage') current.companyPage = store.global.companyPage(cmd.query);
        if (cmd.op === 'starterDirectoryPage')
          current.starterDirectoryPage = store.starterDirectoryPage(cmd.query);
        if (cmd.op === 'rankingJobs') {
          const choices = store.rankingJobChoices(cmd.query, cmd.offset);
          current.rankingJobs = choices.rows;
          current.rankingJobTotal = choices.total;
        }
        if (cmd.op === 'requestLog') {
          const log = store.global.requests(cmd.lane, cmd.sourceId, cmd.offset);
          current.requests = log.rows;
          current.requestTotal = log.total;
        }
        if (cmd.op === 'previewRanking')
          current.comparisons = [
            store.cachedRanking(
              { job: store.job(cmd.jobId), bm25Raw: 0 },
              store.profile() ?? emptyProfile(),
              cmd.config,
              new Date().toISOString().slice(0, 10),
            ),
          ];
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
        companies.shutdown(),
        viewQueue.catch(() => {}),
      ]);
    },
  };
}
