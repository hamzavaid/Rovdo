/**
 * Shared main-process security policy for the application window and local asset protocol.
 * Keep frame ownership checks, CSP and asset-path containment together when changing the desktop boundary.
 */
import { resolve } from 'node:path';

export const APP_URL = 'rovdo://app/index.html';

export const WINDOW_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
});

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function isTrustedFrame(url: string, isMainFrame: boolean): boolean {
  return isMainFrame && url === APP_URL;
}

export function getAssetPath(requestUrl: string, rendererRoot: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (
      url.protocol !== 'rovdo:' ||
      url.host !== 'app' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    if (url.pathname === '/index.html') return resolve(rendererRoot, 'index.html');
    if (/^\/assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(js|css|svg|png|woff2)$/.test(url.pathname)) {
      return resolve(rendererRoot, `.${url.pathname}`);
    }
    return null;
  } catch {
    return null;
  }
}
