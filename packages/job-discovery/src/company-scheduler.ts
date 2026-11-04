/** Independent main-process scheduling. Archive work never competes with foreground acquisition. */
import type { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';

export class CompanyDiscoveryScheduler {
  readonly engine: GlobalDiscoveryEngine;
  private active = false;
  private stopped = false;
  constructor(
    private readonly store: CareerStore,
    private readonly options: NonNullable<
      ConstructorParameters<typeof GlobalDiscoveryEngine>[1]
    > & { suspended?: () => boolean; automaticStart?: () => boolean } = {},
  ) {
    this.engine = new GlobalDiscoveryEngine(store, { ...options, lane: 'companies' });
  }
  start() {
    const running = this.store.global.runningRuns().find((r) => r.lane === 'companies');
    if (running) return running.id;
    const id = this.engine.start({
      sourceIds: ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'wayback', 'common-crawl'],
      overrides: {},
    });
    this.store.setting('company-discovery-next', String(Date.now() + 7 * 86400000));
    return id;
  }
  async tick() {
    if (
      this.active ||
      this.stopped ||
      this.options.suspended?.() ||
      this.store.global.runningRuns().some((r) => (r.lane ?? 'jobs') === 'jobs')
    )
      return;
    this.active = true;
    try {
      const runs = this.store.global.runs(0, 'companies');
      const latest = runs[0];
      if (latest?.status === 'paused') {
        if (!/Restarted|shutdown/i.test(latest.reason ?? '')) return;
        await this.engine.control(latest.id, 'resume');
      } else if (!runs.some((r) => r.status === 'running')) {
        if (this.store.setting('automatic-company-discovery') === 'false') return;
        if (this.options.automaticStart?.() === false) return;
        if (Number(this.store.setting('company-discovery-next') ?? 0) > Date.now()) return;
        this.start();
      }
      await this.engine.tick();
    } finally {
      this.active = false;
    }
  }
  async control(id: string, action: 'pause' | 'resume' | 'cancel') {
    if (this.store.global.run(id).lane !== 'companies') throw new Error('WRONG_DISCOVERY_LANE');
    return this.engine.control(id, action);
  }
  async shutdown() {
    this.stopped = true;
    await this.engine.shutdown();
  }
}
