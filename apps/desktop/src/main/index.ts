/**
 * Electron composition root: constructs stores, privileged services and the main window.
 * Registers owned-frame IPC handlers, serves local assets, and drains active work before closing SQLite.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { app, nativeTheme, BrowserWindow, ipcMain, protocol, session, dialog } from 'electron';
import { improveImport } from './import-assistance';
import { createIntelligenceService } from './intelligence-service';
import { readProfileFile } from './profile-file';
import { INTELLIGENCE_CHANNEL } from '@rovdo/shared';
import { createLogger } from '@rovdo/agent-core';
import { APP_INFO_CHANNEL, BYOK_CHANNELS, BROWSER_CHANNEL, CAREER_CHANNEL } from '@rovdo/shared';
import { SettingsStore, RuntimeStore, CareerStore } from '@rovdo/storage';
import { DiscoveryEngine, EMPLOYERS } from '@rovdo/job-discovery';
import { createCareerService } from './career-service';
import { reviewShortlist } from './career-reviewer';
import { createBrowserService } from './browser-service';
import { ProviderRegistry, createAdapter } from '@rovdo/providers';
import { ByokService } from './byok-service';
import { createNativeVault } from './native-vault';
import { handleByok } from './byok-ipc';
import { getAppInfo } from './ipc';
import { APP_URL, CONTENT_SECURITY_POLICY, getAssetPath, WINDOW_WEB_PREFERENCES } from './security';

const log = createLogger((line) => process.stdout.write(line));
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
let mainWindow: BrowserWindow | null = null;
let service: ByokService | null = null;
let store: SettingsStore | null = null;
let runStore: RuntimeStore | null = null;
let browserService: ReturnType<typeof createBrowserService> | null = null;
let careerStore: CareerStore | null = null;
let discovery: DiscoveryEngine | null = null;
let careerService: ReturnType<typeof createCareerService> | null = null;
let intelligenceService: ReturnType<typeof createIntelligenceService> | null = null;
let discoveryTimer: ReturnType<typeof setInterval> | null = null;
const reviewController = new AbortController();
let shutdownComplete = false;
let shutdownStarted = false;

app.setName('Rovdo');
const dataOverride = app.commandLine.getSwitchValue('rovdo-data-dir');
if (dataOverride) app.setPath('userData', resolve(dataOverride));
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rovdo',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1160,
    height: 800,
    minWidth: 760,
    minHeight: 580,
    title: 'Rovdo',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101725' : '#f5f6f8',
    show: true,
    webPreferences: { ...WINDOW_WEB_PREFERENCES, preload: join(__dirname, '../preload/index.cjs') },
  });
  mainWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('closed', () => {
    service?.reset();
    void browserService?.runtime.shutdown();
    if (mainWindow === window) mainWindow = null;
  });
  await window.loadURL(APP_URL);
  window.show();
}

async function initialize(): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  // Compose privileged dependencies here; feature modules receive only the capabilities they need.
  store = new SettingsStore(join(app.getPath('userData'), 'rovdo.sqlite'));
  const registry = new ProviderRegistry();
  for (const kind of ['openai', 'anthropic', 'compatible'] as const)
    registry.register(kind, createAdapter);
  const vault = createNativeVault(() => nativeTheme.shouldUseDarkColors);
  service = new ByokService(
    store,
    vault,
    (config, key) => registry.create(config, key),
    app.getVersion(),
  );
  runStore = new RuntimeStore(join(app.getPath('userData'), 'rovdo.sqlite'));
  browserService = createBrowserService(runStore, store, vault);
  careerStore = new CareerStore(join(app.getPath('userData'), 'rovdo.sqlite'));
  const appearance = careerStore.setting('appearance');
  nativeTheme.themeSource = appearance === 'dark' || appearance === 'light' ? appearance : 'system';
  intelligenceService = createIntelligenceService(
    careerStore,
    async (signal) => {
      if (!mainWindow) throw new Error('NO_WINDOW');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import candidate qualifications',
        properties: ['openFile'],
        filters: [
          {
            name: 'Profile documents or LinkedIn archives',
            extensions: ['pdf', 'docx', 'txt', 'md', 'markdown', 'json', 'zip', 'csv'],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return readProfileFile(result.filePaths[0], signal);
    },
    (mode) => {
      nativeTheme.themeSource = mode;
    },
    (preview, request, signal) => improveImport(preview, request, store!, vault, signal),
  );
  // A valid payload is insufficient: every command also carries the owning-window/main-frame identity.
  ipcMain.handle(INTELLIGENCE_CHANNEL, (event, payload: unknown) =>
    intelligenceService!.command(payload, {
      url: event.senderFrame?.url ?? '',
      isMainFrame: event.senderFrame === event.sender.mainFrame,
      ownsWindow: !!mainWindow && event.sender === mainWindow.webContents,
    }),
  );
  careerStore.seedDirectory(EMPLOYERS);
  discovery = new DiscoveryEngine(careerStore);
  careerService = createCareerService(careerStore, discovery, (request) =>
    reviewShortlist(request, careerStore!, store!, vault, reviewController.signal),
  );
  ipcMain.handle(CAREER_CHANNEL, (event, payload: unknown) =>
    careerService!.command(payload, {
      url: event.senderFrame?.url ?? '',
      isMainFrame: event.senderFrame === event.sender.mainFrame,
      ownsWindow: !!mainWindow && event.sender === mainWindow.webContents,
    }),
  );
  discoveryTimer = setInterval(() => {
    void discovery?.pollAll().catch(() => {});
  }, 60000);
  void discovery.pollAll().catch(() => {});
  ipcMain.handle(BROWSER_CHANNEL, (event, payload: unknown) =>
    browserService!.command(payload, {
      url: event.senderFrame?.url ?? '',
      isMainFrame: event.senderFrame === event.sender.mainFrame,
      ownsWindow: !!mainWindow && event.sender === mainWindow.webContents,
    }),
  );
  for (const channel of Object.values(BYOK_CHANNELS).filter(
    (name) => name !== BYOK_CHANNELS.event,
  )) {
    ipcMain.handle(channel, (event, payload: unknown) =>
      handleByok(
        service!,
        channel,
        payload,
        {
          url: event.senderFrame?.url ?? '',
          isMainFrame: event.senderFrame === event.sender.mainFrame,
          ownsWindow: !!mainWindow && event.sender === mainWindow.webContents,
        },
        (message) => {
          if (!event.sender.isDestroyed() && event.senderFrame?.url === APP_URL)
            event.sender.send(BYOK_CHANNELS.event, message);
        },
      ),
    );
  }
  // The renderer loads local application assets only. Main-process services own all permitted egress.
  const rendererRoot = join(__dirname, '../renderer');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      callback({ cancel: !details.url.startsWith('rovdo://app/') });
    },
  );
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
      return getAppInfo(
        payload,
        {
          url: event.senderFrame?.url ?? '',
          isMainFrame: event.senderFrame === event.sender.mainFrame,
        },
        app.getVersion(),
      );
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
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady())
    void createWindow().catch(failStartup);
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// Abort and drain producers before closing the stores they may still be writing to.
app.on('before-quit', (event) => {
  if (shutdownComplete || !store) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (discoveryTimer) clearInterval(discoveryTimer);
  reviewController.abort();
  void Promise.all([
    service?.shutdown(),
    browserService?.runtime.shutdown(),
    discovery?.shutdown(),
    careerService?.shutdown(),
    intelligenceService?.shutdown(),
  ]).finally(() => {
    careerStore?.close();
    runStore?.close();
    store?.close();
    shutdownComplete = true;
    app.quit();
  });
});
app.on('will-quit', () => {
  service?.cancel();
  log({ level: 'info', event: 'app.stopped', component: 'main' });
});
