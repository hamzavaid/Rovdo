import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { createLogger } from '@rovdo/agent-core';
import { APP_INFO_CHANNEL, BYOK_CHANNELS, BROWSER_CHANNEL } from '@rovdo/shared';
import { SettingsStore, RuntimeStore } from '@rovdo/storage';
import { createBrowserService } from './browser-service';
import { ProviderRegistry, createAdapter } from '@rovdo/providers';
import { ByokService } from './byok-service';
import { createNativeVault } from './native-vault';
import { handleByok } from './byok-ipc';
import { getAppInfo } from './ipc';
import { APP_URL, CONTENT_SECURITY_POLICY, getAssetPath, WINDOW_WEB_PREFERENCES } from './security';

const log = createLogger((line) => process.stdout.write(line));
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
let mainWindow: BrowserWindow | null = null;
let service: ByokService | null = null;
let store: SettingsStore | null = null;
let runStore: RuntimeStore | null = null;
let browserService: ReturnType<typeof createBrowserService> | null = null;
let shutdownComplete = false;
let shutdownStarted = false;

app.setName('Rovdo');
const dataOverride = app.commandLine.getSwitchValue('rovdo-data-dir');
if (dataOverride) app.setPath('userData', resolve(dataOverride));
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{
  scheme: 'rovdo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1160, height: 800, minWidth: 760, minHeight: 580,
    title: 'Rovdo', backgroundColor: '#f5f6f8', show: true,
    webPreferences: { ...WINDOW_WEB_PREFERENCES, preload: join(__dirname, '../preload/index.cjs') },
  });
  mainWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('closed', () => { service?.reset(); void browserService?.runtime.shutdown(); if (mainWindow === window) mainWindow = null; });
  await window.loadURL(APP_URL);
  window.show();
}

async function initialize(): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  store = new SettingsStore(join(app.getPath('userData'), 'rovdo.sqlite'));
  const registry = new ProviderRegistry();
  for (const kind of ['openai', 'anthropic', 'compatible'] as const) registry.register(kind, createAdapter);
  const vault = createNativeVault();
  service = new ByokService(store, vault, (config, key) => registry.create(config, key), app.getVersion());
  runStore = new RuntimeStore(join(app.getPath('userData'), 'rovdo.sqlite'));
  browserService = createBrowserService(runStore, store, vault);
  ipcMain.handle(BROWSER_CHANNEL, (event, payload: unknown) => browserService!.command(payload, {
    url: event.senderFrame?.url ?? '', isMainFrame: event.senderFrame === event.sender.mainFrame,
    ownsWindow: !!mainWindow && event.sender === mainWindow.webContents,
  }));
  for (const channel of Object.values(BYOK_CHANNELS).filter((name) => name !== BYOK_CHANNELS.event)) {
    ipcMain.handle(channel, (event, payload: unknown) => handleByok(service!, channel, payload, {
      url: event.senderFrame?.url ?? '', isMainFrame: event.senderFrame === event.sender.mainFrame,
      ownsWindow: !!mainWindow && event.sender === mainWindow.webContents,
    }, (message) => {
      if (!event.sender.isDestroyed() && event.senderFrame?.url === APP_URL) event.sender.send(BYOK_CHANNELS.event, message);
    }));
  }
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
app.on('before-quit', (event) => {
  if (shutdownComplete || !store) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void Promise.all([service?.shutdown(), browserService?.runtime.shutdown()]).finally(() => {
    runStore?.close(); store?.close(); shutdownComplete = true; app.quit();
  });
});
app.on('will-quit', () => { service?.cancel(); log({ level: 'info', event: 'app.stopped', component: 'main' }); });
