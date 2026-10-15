import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { createLogger } from '@rovdo/agent-core';
import { APP_INFO_CHANNEL } from '@rovdo/shared';
import { getAppInfo } from './ipc';
import { APP_URL, CONTENT_SECURITY_POLICY, getAssetPath, WINDOW_WEB_PREFERENCES } from './security';

const log = createLogger((line) => process.stdout.write(line));
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
let mainWindow: BrowserWindow | null = null;

app.setName('Rovdo');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{
  scheme: 'rovdo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1160, height: 800, minWidth: 760, minHeight: 580,
    title: 'Rovdo', backgroundColor: '#f5f6f8', show: false,
    webPreferences: { ...WINDOW_WEB_PREFERENCES, preload: join(__dirname, '../preload/index.cjs') },
  });
  mainWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  await window.loadURL(APP_URL);
  window.show();
}

async function initialize(): Promise<void> {
  const rendererRoot = join(__dirname, '../renderer');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !details.url.startsWith('rovdo://app/') });
  });
  protocol.handle('rovdo', async (request) => {
    const assetPath = getAssetPath(request.url, rendererRoot);
    if (request.method !== 'GET' || !assetPath) return new Response('Not found', { status: 404 });
    try {
      const content = await readFile(assetPath);
      return new Response(new Uint8Array(content), {
        headers: {
          'Content-Type': MIME_TYPES[extname(assetPath)] ?? 'application/octet-stream',
          'Content-Security-Policy': CONTENT_SECURITY_POLICY,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle(APP_INFO_CHANNEL, (event, payload: unknown) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('IPC_FORBIDDEN');
      return getAppInfo(payload, {
        url: event.senderFrame?.url ?? '',
        isMainFrame: event.senderFrame === event.sender.mainFrame,
      }, app.getVersion());
    } catch {
      log({ level: 'warn', event: 'ipc.rejected', component: 'main', errorCode: 'IPC_FORBIDDEN' });
      throw new Error('IPC_FORBIDDEN');
    }
  });

  await createWindow();
  log({ level: 'info', event: 'app.started', component: 'main' });
}

function failStartup(): void {
  log({ level: 'error', event: 'app.stopped', component: 'main', errorCode: 'INTERNAL_ERROR' });
  app.exit(1);
}

void app.whenReady().then(initialize).catch(failStartup);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) void createWindow().catch(failStartup);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => log({ level: 'info', event: 'app.stopped', component: 'main' }));
