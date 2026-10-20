import { describe, expect, it } from 'vitest';
import { publicAddress, readPublic } from './network';
describe('public read transport', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.2.3',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fd00::1',
  ])('rejects private address %s', (address) => {
    expect(publicAddress(address)).toBe(false);
  });
  it.each(['http://example.com/', 'file:///etc/passwd', 'https://user:password@example.com/'])(
    'rejects forbidden transport URL %s',
    async (url) => {
      await expect(readPublic(url)).rejects.toThrow();
    },
  );
});
