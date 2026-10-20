/**
 * Destination-scoped provider HTTP transport with DNS validation and connection pinning.
 * Explicit loopback models are supported; redirects and unrelated credential-bearing destinations are rejected.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { connect as tlsConnect } from 'node:tls';
import { Readable } from 'node:stream';
import { isProviderUrl } from '@rovdo/shared';
import { ProviderError } from './errors';

type Address = { address: string; family: number };
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Canceled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function isPublic(address: string): boolean {
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

export async function validateDestination(
  value: string,
  resolveAddresses: (hostname: string) => Promise<Address[]> = (hostname) =>
    lookup(hostname, { all: true }),
): Promise<Address> {
  if (!isProviderUrl(value)) throw new ProviderError('DESTINATION_BLOCKED');
  const url = new URL(value);
  if (url.hostname === '127.0.0.1') return { address: '127.0.0.1', family: 4 };
  if (url.hostname === '[::1]') return { address: '::1', family: 6 };
  // Reject mixed public/private DNS answers; checking only the first answer could permit rebinding.
  const addresses = await resolveAddresses(url.hostname);
  if (!addresses.length || addresses.some((item) => !isPublic(item.address)))
    throw new ProviderError('DESTINATION_BLOCKED');
  return addresses[0]!;
}

// DNS is resolved and checked for every request, then pinned at connect time.
// Credentials are never forwarded to a redirect or sent to a proxy as headers.
export function createSafeFetch(baseUrl: string, proxyUrl?: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const base = new URL(baseUrl);
    const prefix = base.pathname.replace(/\/$/, '');
    if (
      url.origin !== base.origin ||
      !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new ProviderError('DESTINATION_BLOCKED');
    const target = await abortable(validateDestination(baseUrl), request.signal);
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > 1_000_000) throw new ProviderError('VALIDATION_ERROR');
    let socket: ReturnType<typeof tlsConnect> | undefined;
    if (proxyUrl) {
      if (url.protocol !== 'https:') throw new ProviderError('DESTINATION_BLOCKED');
      const proxy = new URL(proxyUrl);
      const proxyAddress = await abortable(validateDestination(proxyUrl), request.signal);
      socket = await new Promise((resolve, reject) => {
        const authority = `${target.family === 6 ? `[${target.address}]` : target.address}:${url.port || '443'}`;
        const tunnel = httpsRequest(proxy, {
          method: 'CONNECT',
          path: authority,
          signal: request.signal,
          family: proxyAddress.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, proxyAddress.address, proxyAddress.family),
        });
        tunnel.once('connect', (response, connection, head) => {
          if (response.statusCode !== 200 || head.length) {
            connection.destroy();
            reject(new ProviderError('PROVIDER_UNAVAILABLE'));
            return;
          }
          const secure = tlsConnect({ socket: connection, servername: url.hostname });
          secure.once('secureConnect', () => resolve(secure));
          secure.once('error', reject);
        });
        tunnel.once('error', reject);
        tunnel.end();
      });
    }
    const agent = socket ? new HttpsAgent({ keepAlive: false }) : undefined;
    if (agent && socket) agent.createConnection = () => socket!;
    return await new Promise<Response>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const outgoing = send(
        url,
        {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          signal: request.signal,
          family: target.family,
          lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
          ...(agent ? { agent } : {}),
        },
        (response) => {
          if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
            response.destroy();
            reject(new ProviderError('DESTINATION_BLOCKED'));
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers))
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          resolve(
            new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
              status: response.statusCode ?? 500,
              headers,
            }),
          );
        },
      );
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  };
}
