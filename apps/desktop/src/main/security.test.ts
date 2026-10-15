import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_URL, CONTENT_SECURITY_POLICY, getAssetPath, isTrustedFrame, WINDOW_WEB_PREFERENCES } from './security';
import { getAppInfo } from './ipc';

describe('desktop security boundary', () => {
  it('disables privileged renderer features', () => {
    expect(WINDOW_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, webviewTag: false,
    });
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline');
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
  });

  it('trusts only the exact local main frame', () => {
    expect(isTrustedFrame(APP_URL, true)).toBe(true);
    for (const url of ['https://evil.example', `${APP_URL}?token=secret`, 'rovdo://evil/index.html', 'rovdo://app/other.html', APP_URL]) {
      expect(isTrustedFrame(url, false)).toBe(false);
    }
    expect(isTrustedFrame(`${APP_URL}?token=secret`, true)).toBe(false);
  });

  it('serves only renderer documents and bundled assets', () => {
    const root = resolve('renderer');
    expect(getAssetPath(APP_URL, root)).toBe(resolve(root, 'index.html'));
    expect(getAssetPath('rovdo://app/assets/index-a12.js', root)).toBe(resolve(root, 'assets/index-a12.js'));
  });

  it.each([
    'file:///etc/passwd', 'https://app/index.html', 'rovdo://other/index.html',
    'rovdo://app/assets/../../main/index.cjs', 'rovdo://app/%2e%2e/main/index.cjs',
    'rovdo://app/assets/%2e%2e%2fsecret.js', 'rovdo://app/assets/secret%5cfile.js',
    'rovdo://user:pass@app/index.html', 'rovdo://app:3000/index.html',
    'rovdo://app/../package.json', 'rovdo://app/assets/config.json', 'not-a-url',
  ])('refuses arbitrary file requests: %s', (url) => {
    expect(getAssetPath(url, resolve('renderer'))).toBeNull();
  });
});

describe('app information IPC handler', () => {
  it('returns only public app metadata to the trusted frame', () => {
    expect(getAppInfo({}, { url: APP_URL, isMainFrame: true }, '0.1.0')).toEqual({
      name: 'Rovdo', version: '0.1.0', milestone: 'foundation', networkEnabled: false,
    });
  });

  it.each([
    [{}, { url: 'https://evil.example', isMainFrame: true }],
    [{}, { url: APP_URL, isMainFrame: false }],
    [{ apiKey: 'secret-canary' }, { url: APP_URL, isMainFrame: true }],
  ])('rejects untrusted callers or payloads without echoing input', (payload, sender) => {
    expect(() => getAppInfo(payload, sender, '0.1.0')).toThrow(/^(IPC_FORBIDDEN|VALIDATION_ERROR)$/);
    expect(() => getAppInfo(payload, sender, '0.1.0')).not.toThrow(/secret-canary/);
  });
});
