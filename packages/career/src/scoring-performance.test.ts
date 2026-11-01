/** Diagnostic workload, not a universal latency SLA. Run explicitly with ROVDO_PERFORMANCE=1. */
import { expect, it } from 'vitest';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
import { prepareRanking, rankWithProfile, BUILTIN_RANKINGS } from './scorer-v2';
it.runIf(process.env.ROVDO_PERFORMANCE === '1')(
  'measures 20–240 skills over thousand-job batches with CPU, memory and loop delay',
  async () => {
    const measurements = [];
    for (const count of [20, 50, 100, 150, 240]) {
      const p = sampleCandidate([]);
      p.intelligence!.skills = Array.from({ length: count }, (_, i) => ({
        id: `s${i}`,
        skillId: `custom:s${i}`,
        version: null,
        depth: 'declared' as const,
        verified: true,
        evidenceIds: ['assertion'],
      }));
      const row = { job: sampleJob('TypeScript required'), bm25Raw: 0 };
      const before = performance.now();
      rankWithProfile([row], p, BUILTIN_RANKINGS[1]!, AS_OF);
      const singleMs = performance.now() - before;
      const delay = monitorEventLoopDelay({ resolution: 1 });
      delay.enable();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const cpu = process.cpuUsage(),
        heap = process.memoryUsage().heapUsed,
        started = performance.now();
      const prepared = prepareRanking(p, BUILTIN_RANKINGS[1]!, AS_OF);
      for (let i = 0; i < 1000; i++) {
        prepared.rank([{ ...row, job: { ...row.job, id: `perf-${i}` } }]);
        await yieldTurn();
      }
      delay.disable();
      const used = process.cpuUsage(cpu);
      measurements.push({
        skills: count,
        singleMs,
        batchMs: performance.now() - started,
        maximumEventLoopDelayMs: delay.max / 1e6,
        cpuMs: (used.user + used.system) / 1000,
        heapDeltaBytes: process.memoryUsage().heapUsed - heap,
        rssBytes: process.memoryUsage().rss,
      });
      expect(singleMs).toBeLessThan(500);
      expect(delay.max / 1e6).toBeLessThan(500);
    }
    mkdirSync('artifacts', { recursive: true });
    writeFileSync(
      'artifacts/candidate-performance.json',
      JSON.stringify({ node: process.version, platform: process.platform, measurements }, null, 2),
    );
    process.stdout.write(
      'Candidate performance diagnostics ' + JSON.stringify(measurements) + '\n',
    );
  },
  60000,
);
