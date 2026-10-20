/**
 * Bounded unauthenticated public GET transport for ATS feeds, GitHub and browser resources.
 * Public-address checks and DNS pinning limit SSRF; redirects and ambient browser credentials are not followed.
 */
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function publicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^[23][0-9a-f]{0,3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0] = address.split('.').map(Number);
  return (
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 198 && [18, 19].includes(b))
  );
}
export type PublicResponse = { status: number; headers: Record<string, string>; body: Buffer };
export type ReadOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fixtureOrigin?: string;
};

// The browser never connects to origin servers itself: resolve, validate and pin
// each request here. Redirects are returned to Chromium and checked again.
export async function readPublic(url: string, options: ReadOptions = {}): Promise<PublicResponse> {
  const target = new URL(url);
  if (
    target.username ||
    target.password ||
    (target.protocol !== 'https:' && target.origin !== options.fixtureOrigin)
  )
    throw new Error('DESTINATION_BLOCKED');
  const fixture = target.origin === options.fixtureOrigin && target.hostname === '127.0.0.1';
  const addresses = fixture
    ? [{ address: '127.0.0.1', family: 4 }]
    : await lookup(target.hostname, { all: true });
  if (!addresses.length || (!fixture && addresses.some((a) => !publicAddress(a.address))))
    throw new Error('DESTINATION_BLOCKED');
  const address = addresses[0]!;
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(15000),
  ]);
  return new Promise((resolve, reject) => {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    if (Object.keys(options.headers ?? {}).some((h) => /authorization|cookie|proxy/i.test(h)))
      throw new Error('DESTINATION_BLOCKED');
    const req = send(
      target,
      {
        method: 'GET',
        headers: {
          'user-agent': 'Rovdo/0.3.8 (public-source reader)',
          'accept-encoding': 'identity',
          ...options.headers,
        },
        signal,
        family: address.family,
        lookup: (_h, _o, cb) => cb(null, address.address, address.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8_000_000) {
            req.destroy(new Error('RESPONSE_TOO_LARGE'));
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers))
            if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
          resolve({ status: res.statusCode ?? 500, headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
