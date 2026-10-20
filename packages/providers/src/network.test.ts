import { describe, expect, it } from 'vitest';
import { validateDestination, createSafeFetch } from './network';
import { createServer } from 'node:http';

describe('main-process provider network boundary', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
  ])('rejects private DNS answers %s', async (address) => {
    await expect(
      validateDestination('https://models.example.com/v1', async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
    ).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
  });
  it('pins a public address and permits only explicitly configured loopback literals', async () => {
    expect(
      (
        await validateDestination('https://models.example.com/v1', async () => [
          { address: '93.184.216.34', family: 4 },
        ])
      ).address,
    ).toBe('93.184.216.34');
    expect((await validateDestination('http://127.0.0.1:11434/v1')).address).toBe('127.0.0.1');
  });
  it('rejects requests outside the configured base path before sending credentials', async () => {
    const fetcher = createSafeFetch('https://api.openai.com/v1');
    await expect(fetcher('https://evil.example/v1/chat/completions')).rejects.toMatchObject({
      code: 'DESTINATION_BLOCKED',
    });
    await expect(fetcher('https://api.openai.com/other')).rejects.toMatchObject({
      code: 'DESTINATION_BLOCKED',
    });
  });
  it('never follows redirects with authorization, and aborts stalled connections', async () => {
    let redirected = false;
    const server = createServer((request, response) => {
      if (request.url === '/v1/redirect') response.writeHead(302, { location: '/v1/leak' }).end();
      else if (request.url === '/v1/leak') {
        redirected = true;
        response.end();
      } else request.resume();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
    const base = `http://127.0.0.1:${address.port}/v1`;
    try {
      const fetcher = createSafeFetch(base);
      await expect(
        fetcher(`${base}/redirect`, { headers: { authorization: 'Bearer canary' } }),
      ).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
      expect(redirected).toBe(false);
      await expect(
        fetcher(`${base}/stall`, { signal: AbortSignal.timeout(50) }),
      ).rejects.toBeDefined();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
