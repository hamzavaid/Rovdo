import { setTimeout as delay } from 'node:timers/promises';
import { IntelligenceCommandSchema, IntelligenceResultSchema, AppearanceSchema } from '@rovdo/shared';
import type { ImportPreview, Appearance } from '@rovdo/shared';
import { githubPreview, mergeReviewed, previewText } from '@rovdo/profile-import';
import { readPublic } from '@rovdo/shared/network';
import type { CareerStore } from '@rovdo/storage';
import { isTrustedFrame } from './security';

export function createIntelligenceService(store: CareerStore, chooseFile: (signal: AbortSignal) => Promise<ImportPreview | null>, applyAppearance: (mode: Appearance) => void = () => {}) {
  const controller = new AbortController(); let busy = false; let pending: Promise<unknown> | null = null;
  const view = () => ({ profile: store.profile(), rankings: store.rankings(), defaultRanking: store.defaultRanking(), previews: store.importPreviews(), appearance: AppearanceSchema.parse(store.setting('appearance') ?? 'system') });
  return {
    async command(input: unknown, sender: { url: string; isMainFrame: boolean; ownsWindow: boolean }) {
      if (!sender.ownsWindow || !isTrustedFrame(sender.url, sender.isMainFrame)) return IntelligenceResultSchema.parse({ ok: false, code: 'IPC_FORBIDDEN' });
      const parsed = IntelligenceCommandSchema.safeParse(input); if (!parsed.success) return IntelligenceResultSchema.parse({ ok: false, code: 'VALIDATION_ERROR' });
      const command = parsed.data;
      let acquired = false;
      try {
        if (command.op === 'view') return IntelligenceResultSchema.parse({ ok: true, view: view() });
        if (busy || controller.signal.aborted) return IntelligenceResultSchema.parse({ ok: false, code: 'BUSY' });
        busy = true; acquired = true;
        const work = async () => {
          if (command.op === 'appearance') { store.setting('appearance', command.mode); applyAppearance(command.mode); }
          if (command.op === 'importFile') { const draft = await chooseFile(controller.signal); if (draft) store.saveImport(draft); }
          if (command.op === 'paste') store.saveImport(previewText(command.text, command.kind === 'linkedin' ? 'Pasted LinkedIn profile' : 'Pasted profile', command.kind, new Date().toISOString()));
          if (command.op === 'github') {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
            const draft = await githubPreview(command.username, command.limit, new Date().toISOString(), async (url) => {
              const origin = 'https://api.github.com'; const now = Date.now(); const at = store.reserveOrigin(origin, now); if (at - now > 30000) throw new Error('GITHUB_COOLDOWN');
              if (at > now) await delay(at - now, undefined, { signal });
              if (store.originBlockedUntil(origin) > Date.now()) throw new Error('GITHUB_COOLDOWN');
              const response = await readPublic(url, { signal, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
              const retry = Number(response.headers['retry-after'] ?? 0) * 1000; const reset = Number(response.headers['x-ratelimit-reset'] ?? 0) * 1000;
              if (response.status === 403 || response.status === 429 || response.headers['x-ratelimit-remaining'] === '0') store.deferOrigin(origin, Math.max(Date.now() + Math.max(1000, Number.isFinite(retry) ? retry : 0), Number.isFinite(reset) ? reset : 0));
              return response;
            }); store.saveImport(draft);
          }
          if (command.op === 'applyImport') {
            const original = store.importPreview(command.id);
            const edited = { ...original, intelligence: command.intelligence, facts: command.facts.map((f) => ({ ...f, verified: false })) };
            store.commitImport(original.id, mergeReviewed(store.profile(), edited, command.selectedIds, command.confirmSensitive));
          }
          if (command.op === 'rejectImport') store.rejectImport(command.id);
          if (command.op === 'importRanking') store.importRanking(command.json);
          if (command.op === 'resetRanking') store.resetRanking(command.id, command.presetId);
          if (command.op === 'cloneRanking') store.cloneRanking(command.id, command.name);
          if (command.op === 'saveRanking') store.saveRanking(command.profile);
          if (command.op === 'deleteRanking') store.deleteRanking(command.id);
          if (command.op === 'defaultRanking') store.setDefaultRanking(command.id);
        };
        pending = work(); await pending; return IntelligenceResultSchema.parse({ ok: true, view: view() });
      } catch { return IntelligenceResultSchema.parse({ ok: false, code: 'IMPORT_ERROR' }); }
      finally { if (acquired) { busy = false; pending = null; } }
    },
    async shutdown() { controller.abort(); await pending?.catch(() => {}); },
  };
}
