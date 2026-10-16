import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { validateDestination } from '@rovdo/providers';

// The browser never connects to origin servers itself: resolve, validate and pin
// each request here. Redirects are returned to Chromium and checked again.
export async function readPublic(url: string, options: { headers?: Record<string, string>; signal?: AbortSignal; fixtureOrigin?: string } = {}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const target = new URL(url);
  if (target.username || target.password || (target.protocol !== 'https:' && target.origin !== options.fixtureOrigin)) throw new Error('DESTINATION_BLOCKED');
  const address = target.origin === options.fixtureOrigin ? { address: '127.0.0.1', family: 4 } : await validateDestination(target.origin);
  if (target.origin !== options.fixtureOrigin && /^(127\.|::1$)/.test(address.address)) throw new Error('DESTINATION_BLOCKED');
  return new Promise((resolve, reject) => {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(target, { method: 'GET', headers: { 'user-agent': 'Rovdo/0.1.0 (public-source reader)', 'accept-encoding': 'identity', ...options.headers }, signal: options.signal ?? AbortSignal.timeout(15000), family: address.family,
      lookup: (_h, _o, cb) => cb(null, address.address, address.family) }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8_000_000) { req.destroy(new Error('RESPONSE_TOO_LARGE')); } else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => {
        const headers: Record<string, string> = {}; for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
        resolve({ status: res.statusCode ?? 500, headers, body: Buffer.concat(chunks) });
      });
    }); req.on('error', reject); req.end();
  });
}
