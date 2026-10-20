/**
 * Validates career IPC commands and coordinates local profile, job and source operations.
 * Returns a consistent view after mutations while keeping optional AI review separate from discovery.
 */
import { emptyProfile, expandSearch } from '@rovdo/career';
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
) {
  const controller = new AbortController();
  let discovering: Promise<void> | null = null;
  let reviewing = false;
  let pendingReview: Promise<void> | null = null;
  function view(input: JobSearch = defaultSearch) {
    const search = JobSearchSchema.parse(input);
    const profile = store.profile();
    const saved = store.savedIds();
    const sources = store.sources();
    const rows = store.searchFiltered({ ...search, query: expandSearch(search.query) });
    const config = store
      .rankings()
      .find((p) => p.id === (search.rankingId ?? store.defaultRanking()));
    if (!config) throw new Error('RANKING_NOT_FOUND');
    const candidate = profile ?? emptyProfile();
    const asOf = new Date().toISOString().slice(0, 10);
    for (const row of rows) store.cachedRanking(row, candidate, config, asOf);
    const page = store.rankedPage(rows, candidate, config, asOf, search);
    const visible = page.matches;
    const totalJobs = store.jobCount();
    return {
      profile,
      sources,
      matches: visible,
      matchedCount: page.total,
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
        if (cmd.op === 'saveProfile') store.saveProfile(cmd.profile);
        if (cmd.op === 'proposeFacts') store.proposeFacts(cmd.facts);
        if (cmd.op === 'saveSource') {
          if (cmd.source.ats === 'jsonld' && !store.directoryAllowed(cmd.source))
            throw new Error('SOURCE_NOT_APPROVED');
          store.saveSource(cmd.source);
        }
        if (cmd.op === 'deleteSource') store.deleteSource(cmd.id);
        if (cmd.op === 'searchAll') {
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
      await Promise.all([pendingReview?.catch(() => {}), discovering?.catch(() => {})]);
    },
  };
}
