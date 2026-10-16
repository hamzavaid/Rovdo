import { emptyProfile, expandSearch, rankJobs } from '@rovdo/career';
import { CareerCommandSchema, CareerResultSchema, JobSearchSchema } from '@rovdo/shared';
import type { CareerCommand, JobSearch } from '@rovdo/shared';
import type { CareerStore } from '@rovdo/storage';
import type { DiscoveryEngine } from '@rovdo/job-discovery';
import { isTrustedFrame } from './security';

const defaultSearch: JobSearch = { query: '', company: '', workMode: 'all', savedOnly: false, includeExcluded: false };
export function createCareerService(store: CareerStore, engine: DiscoveryEngine, evaluate: (request: Extract<CareerCommand, { op: 'evaluate' }>) => Promise<void>) {
  let reviewing = false;
  let pendingReview: Promise<void> | null = null;
  function view(input: JobSearch = defaultSearch) {
    const search = JobSearchSchema.parse(input); const profile = store.profile(); const saved = store.savedIds(); const sources = store.sources();
    const rows = store.search(expandSearch(search.query)).filter(({ job }) => (!search.company || job.company.toLowerCase().includes(search.company.toLowerCase())) && (search.workMode === 'all' || job.workMode === search.workMode) && (!search.savedOnly || saved.includes(job.id)));
    const matches = rankJobs(rows, profile ?? emptyProfile()); store.saveMatches(matches);
    const visible = matches.filter((m) => search.includeExcluded || !m.excluded);
    const totalJobs = store.jobs().length;
    return { profile, sources, matches: visible.slice(search.offset ?? 0, (search.offset ?? 0) + 50), matchedCount: visible.length, savedIds: saved, reviews: store.reviews().filter((r) => r.profileVersion === profile?.version && store.job(r.jobId).contentSha256 === r.contentHash), totalJobs, polling: engine.polling, outcome: visible.length ? 'RESULTS' as const : sources.some((s) => s.state.status === 'FAILED_SOURCE') ? 'FAILED_SOURCE' as const : !sources.length || sources.every((s) => s.state.status === 'NEVER_POLLED') ? 'NOT_POLLED' as const : totalJobs === 0 ? 'EMPTY_SOURCE' as const : 'ZERO_MATCHES' as const };
  }
  return {
    async command(input: unknown, sender: { url: string; isMainFrame: boolean; ownsWindow: boolean }) {
      if (!sender.ownsWindow || !isTrustedFrame(sender.url, sender.isMainFrame)) return CareerResultSchema.parse({ ok: false, code: 'IPC_FORBIDDEN' });
      const parsed = CareerCommandSchema.safeParse(input); if (!parsed.success) return CareerResultSchema.parse({ ok: false, code: 'VALIDATION_ERROR' });
      const cmd = parsed.data;
      try {
        if (cmd.op === 'saveProfile') store.saveProfile(cmd.profile);
        if (cmd.op === 'proposeFacts') store.proposeFacts(cmd.facts);
        if (cmd.op === 'saveSource') store.saveSource(cmd.source);
        if (cmd.op === 'saveJob') store.saveJob(cmd.jobId, cmd.saved);
        if (cmd.op === 'poll') void engine.pollAll().catch(() => {});
        if (cmd.op === 'evaluate') { if (reviewing) throw new Error('BUSY'); reviewing = true; try { pendingReview = evaluate(cmd); await pendingReview; } finally { reviewing = false; pendingReview = null; } }
        return CareerResultSchema.parse({ ok: true, view: view(cmd.op === 'view' ? cmd.search : defaultSearch) });
      } catch { return CareerResultSchema.parse({ ok: false, code: cmd.op === 'evaluate' ? 'AI_REVIEW_FAILED' : 'CAREER_ERROR' }); }
    },
    async shutdown() { await pendingReview?.catch(() => {}); },
  };
}
