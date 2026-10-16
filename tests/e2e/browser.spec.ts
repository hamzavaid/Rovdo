import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { BrowserWorker } from '../../packages/browser-worker/src/index';
import { readPublic } from '../../packages/browser-worker/src/network';
import { BrowserRuntime } from '../../packages/agent-core/src/browser';
import { RuntimeStore } from '../../packages/storage/src/runtime';

test('isolates contexts, verifies DOM steps and blocks page network bypasses', async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') posts++;
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/latest' }); res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<h1>Search jobs</h1><label>Role<input aria-label="Role"></label><button type="button" onclick="document.querySelector(\'h1\').textContent=\'Review ready\'">Review</button><button type="submit">Submit</button><script>fetch("/steal",{method:"POST",body:"secret"}).catch(()=>{});localStorage.setItem("session","one")</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture');
  const origin = `http://127.0.0.1:${address.port}`;
  const a = new BrowserWorker([origin], { headless: true, fixtureOrigin: origin });
  const b = new BrowserWorker([origin], { headless: true, fixtureOrigin: origin });
  try {
    await a.open(origin); await b.open(origin);
    expect((await a.execute({ tool: 'fill', target: { role: 'textbox', name: 'Role' }, value: 'Engineer' })).verified).toBe(true);
    await a.execute({ tool: 'click', target: { role: 'button', name: 'Review' } });
    expect((await a.observe()).text).toContain('Review ready'); expect((await b.observe()).text).toContain('Search jobs');
    await expect(a.execute({ tool: 'click', target: { role: 'button', name: 'Submit' } })).rejects.toThrow();
    await expect(a.execute({ tool: 'navigate', url: `${origin}/redirect` })).rejects.toThrow();
    expect(posts).toBe(0);
    // The runtime uses a production-shaped HTTPS policy. Only this test's
    // transport maps its authorized origin onto the isolated loopback fixture.
    const approvedOrigin = 'https://fixture.rovdo.test';
    const store = new RuntimeStore(test.info().outputPath('runs.sqlite'));
    const runtime = new BrowserRuntime(store, () => new BrowserWorker([approvedOrigin], { headless: true }, (url) => readPublic(url.replace(approvedOrigin, origin), { fixtureOrigin: origin })), async (record) => ({ actions: [record.steps === 0 ? { tool: 'fill', target: { role: 'textbox', name: 'Role' }, value: 'Engineer' } : { tool: 'click', target: { role: 'button', name: 'Review' } }], inputTokens: 1, outputTokens: 1, usd: 0 }));
    try {
      const id = await runtime.start({ task: 'Fill a mock form and review', startUrl: approvedOrigin, allowedOrigins: [approvedOrigin], expectedText: 'Review ready', modelProfileId: '00000000-0000-4000-8000-000000000001', maxSteps: 2, maxUsd: 0, maxTokens: 100, maxDurationMs: 60000, consent: true });
      for (let step = 0; step < 2; step++) {
        await runtime.settled(); const record = store.get(id); expect(record.state).toBe('AWAITING_APPROVAL');
        await runtime.approve(id, record.approval!.digest, true);
      }
      await runtime.settled(); expect(store.get(id).state).toBe('COMPLETED');
      expect(store.get(id).steps).toBe(2); expect(store.events(id).filter((event) => event.kind === 'verified').length).toBe(3);
      expect(JSON.stringify(store.get(id))).not.toContain('Engineer');
    } finally { await runtime.shutdown(); store.close(); }
  } finally { await a.close(); await b.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
