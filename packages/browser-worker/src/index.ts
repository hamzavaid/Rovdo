import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BrowserActionSchema, ObservationSchema } from '@rovdo/shared';
import type { BrowserAction, Observation } from '@rovdo/shared';
import { readPublic } from './network';
export { readPublic } from './network';

export class BrowserWorker {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private closed = false;
  constructor(private readonly origins: string[], private readonly options: { headless?: boolean; fixtureOrigin?: string } = {}, private readonly transport: typeof readPublic = readPublic) {}
  private allowed(value: string): boolean { try { const u = new URL(value); return !u.username && !u.password && this.origins.includes(u.origin) && (u.protocol === 'https:' || u.origin === this.options.fixtureOrigin); } catch { return false; } }
  async open(url: string): Promise<void> {
    if (!this.allowed(url) || this.closed) throw new Error('DESTINATION_BLOCKED');
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|DISPLAY|XAUTHORITY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR)$/i.test(entry[0]) && entry[1] !== undefined));
    this.browser = await chromium.launch({ headless: this.options.headless ?? false, chromiumSandbox: true, env, args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    if (this.closed) { await this.browser.close(); throw new Error('CANCELED'); }
    this.context = await this.browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, permissions: [], javaScriptEnabled: true });
    this.context.setDefaultTimeout(5000);
    await this.context.addInitScript(() => {
      for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false });
    });
    await this.context.routeWebSocket('**/*', (socket) => socket.close());
    await this.context.route('**/*', async (route) => {
      const req = route.request();
      if (!this.allowed(req.url()) || req.method() !== 'GET' || !['document', 'stylesheet', 'script', 'image', 'font', 'xhr', 'fetch'].includes(req.resourceType())) { await route.abort('blockedbyclient'); return; }
      try {
        const response = await this.transport(req.url(), this.options.fixtureOrigin ? { fixtureOrigin: this.options.fixtureOrigin } : {});
        // Browser cookies, authorization and Set-Cookie never cross this transport.
        delete response.headers['set-cookie']; delete response.headers['content-encoding']; delete response.headers['transfer-encoding'];
        if (response.status >= 300 && response.status < 400) {
          const destination = new URL(response.headers.location ?? '', req.url()).href;
          if (!this.allowed(destination)) { await route.abort('blockedbyclient'); return; }
        }
        await route.fulfill({ ...response, contentType: response.headers['content-type'] ?? 'application/octet-stream' });
      } catch { await route.abort('blockedbyclient').catch(() => {}); }
    });
    this.page = await this.context.newPage();
    this.context.on('page', (page) => { if (page !== this.page) void page.close(); });
    this.page.on('dialog', (dialog) => { void dialog.dismiss(); });
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  async observe(): Promise<Observation> {
    const page = this.page; if (!page || this.closed) throw new Error('WORKER_CLOSED');
    if (!this.allowed(page.url())) throw new Error('DESTINATION_BLOCKED');
    // Clone before extracting: input values, hidden nodes, scripts and active
    // content cannot become observations. This code is fixed, never model-supplied.
    const text = await page.locator('body').evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); const text: string[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!parent || parent.closest('script,style,input,textarea,select,[hidden],[aria-hidden="true"]') || !parent.getClientRects().length || getComputedStyle(parent).visibility !== 'visible') continue;
        text.push(n.textContent ?? ''); if (text.join(' ').length > 15000) break;
      }
      return text.join(' ').replace(/\s+/g, ' ').slice(0, 15000);
    });
    const tree = (await page.locator('body').ariaSnapshot()).replace(/(textbox|combobox|checkbox)([^\n]*):[^\n]*/g, '$1$2: [redacted]').slice(0, 900);
    const safeUrl = new URL(page.url()); safeUrl.search = ''; safeUrl.hash = '';
    return ObservationSchema.parse({ url: safeUrl.href, text: `${text}\n${tree}`.slice(0, 16000), challenge: /captcha|verify (?:you are|your identity)|two.factor|one.time (?:code|password)/i.test(text) });
  }
  async execute(input: BrowserAction): Promise<{ verified: boolean; kind: string }> {
    const action = BrowserActionSchema.parse(input); const page = this.page;
    if (!page || this.closed) throw new Error('WORKER_CLOSED');
    if (action.tool === 'navigate') { if (!this.allowed(action.url)) throw new Error('DESTINATION_BLOCKED'); await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 }); return { verified: page.url() === action.url, kind: action.tool }; }
    if (action.tool === 'snapshot') { await this.observe(); return { verified: true, kind: action.tool }; }
    const target = page.getByRole(action.target.role, { name: action.target.name, exact: true });
    if (await target.count() !== 1 || !await target.isVisible()) throw new Error('TARGET_AMBIGUOUS');
    if (action.tool === 'find') return { verified: true, kind: action.tool };
    const type = await target.getAttribute('type');
    if (type && /password|file|hidden|submit|image/i.test(type)) throw new Error('SENSITIVE_TARGET');
    if (action.tool === 'fill') { await target.fill(action.value); return { verified: await target.inputValue() === action.value, kind: action.tool }; }
    if (action.tool === 'select') { await target.selectOption(action.value); return { verified: await target.inputValue() === action.value, kind: action.tool }; }
    // Submit-like controls, including implicit-submit buttons, remain disabled
    // until the application workflow's idempotence/confirmation milestone.
    const forbidden = await target.evaluate((node) => node.tagName === 'BUTTON' && (!node.getAttribute('type') || node.getAttribute('type') === 'submit'));
    if (forbidden || /submit|send|delete|buy|pay|sign.?in|log.?in|install|apply now/i.test(action.target.name)) throw new Error('SENSITIVE_TARGET');
    if (action.target.role === 'link') { const href = await target.getAttribute('href'); if (!href || !this.allowed(new URL(href, page.url()).href)) throw new Error('DESTINATION_BLOCKED'); }
    const before = await page.locator('body').ariaSnapshot(); const beforeUrl = page.url();
    await target.click({ timeout: 5000 });
    await page.waitForTimeout(100);
    return { verified: beforeUrl !== page.url() || before !== await page.locator('body').ariaSnapshot(), kind: action.tool };
  }
  async close(): Promise<void> { this.closed = true; await this.browser?.close().catch(() => {}); this.page = null; this.context = null; }
}
