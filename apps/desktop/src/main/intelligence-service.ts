/**
 * Coordinates import previews, explicit verification, ranking configurations and appearance settings.
 * Serializes mutations and validates review/evidence boundaries before committing a new profile version.
 */
import { setTimeout as delay } from 'node:timers/promises';
import {
  IntelligenceCommandSchema,
  IntelligenceResultSchema,
  AppearanceSchema,
  ImportFailure,
  importFailureCode,
} from '@rovdo/shared';
import { criticalReviewIds, stable } from '@rovdo/career';
import type { IntelligenceCommand, ImportPreview, Appearance } from '@rovdo/shared';
import { githubPreview, mergeReviewed, previewText } from '@rovdo/profile-import';
import { readPublic } from '@rovdo/shared/network';
import type { CareerStore } from '@rovdo/storage';
import { isTrustedFrame } from './security';

export function createIntelligenceService(
  store: CareerStore,
  chooseFile: (signal: AbortSignal) => Promise<ImportPreview | null>,
  applyAppearance: (mode: Appearance) => void = () => {},
  assist?: (
    preview: ImportPreview,
    request: Extract<IntelligenceCommand, { op: 'assistImport' }>,
    signal: AbortSignal,
  ) => Promise<ImportPreview>,
) {
  const controller = new AbortController();
  let busy = false;
  let pending: Promise<unknown> | null = null;
  const view = () => ({
    profile: store.profile(),
    rankings: store.rankings(),
    defaultRanking: store.defaultRanking(),
    previews: store.importPreviews(),
    appearance: AppearanceSchema.parse(store.setting('appearance') ?? 'system'),
  });
  return {
    async command(
      input: unknown,
      sender: { url: string; isMainFrame: boolean; ownsWindow: boolean },
    ) {
      if (!sender.ownsWindow || !isTrustedFrame(sender.url, sender.isMainFrame))
        return IntelligenceResultSchema.parse({ ok: false, code: 'IPC_FORBIDDEN' });
      const parsed = IntelligenceCommandSchema.safeParse(input);
      if (!parsed.success)
        return IntelligenceResultSchema.parse({ ok: false, code: 'VALIDATION_ERROR' });
      const command = parsed.data;
      let acquired = false;
      try {
        if (command.op === 'view')
          return IntelligenceResultSchema.parse({ ok: true, view: view() });
        // Keep the mutation lock until its original owner finishes, even if another command is rejected.
        if (busy || controller.signal.aborted)
          return IntelligenceResultSchema.parse({ ok: false, code: 'BUSY' });
        busy = true;
        acquired = true;
        const work = async () => {
          if (command.op === 'appearance') {
            store.setting('appearance', command.mode);
            applyAppearance(command.mode);
          }
          if (command.op === 'importFile') {
            const draft = await chooseFile(controller.signal);
            if (draft) store.saveImport(draft);
          }
          if (command.op === 'paste')
            store.saveImport(
              previewText(
                command.text,
                command.kind === 'linkedin' ? 'Pasted LinkedIn profile' : 'Pasted profile',
                command.kind,
                new Date().toISOString(),
              ),
            );
          if (command.op === 'github') {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
            const draft = await githubPreview(
              command.username,
              command.limit,
              new Date().toISOString(),
              async (url) => {
                const origin = 'https://api.github.com';
                const now = Date.now();
                const at = store.reserveOrigin(origin, now);
                if (at - now > 30000) throw new Error('GITHUB_COOLDOWN');
                if (at > now) await delay(at - now, undefined, { signal });
                if (store.originBlockedUntil(origin) > Date.now())
                  throw new Error('GITHUB_COOLDOWN');
                const response = await readPublic(url, {
                  signal,
                  headers: {
                    accept: 'application/vnd.github+json',
                    'x-github-api-version': '2022-11-28',
                  },
                });
                const retry = Number(response.headers['retry-after'] ?? 0) * 1000;
                const reset = Number(response.headers['x-ratelimit-reset'] ?? 0) * 1000;
                if (
                  response.status === 403 ||
                  response.status === 429 ||
                  response.headers['x-ratelimit-remaining'] === '0'
                )
                  store.deferOrigin(
                    origin,
                    Math.max(
                      Date.now() + Math.max(1000, Number.isFinite(retry) ? retry : 0),
                      Number.isFinite(reset) ? reset : 0,
                    ),
                  );
                return response;
              },
            );
            store.saveImport(draft);
          }
          if (command.op === 'assistImport') {
            const original = store.importPreview(command.id);
            if (!assist || original.status !== 'ready') throw new Error('ASSISTANCE_UNAVAILABLE');
            const proposal = await assist(
              original,
              command,
              AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
            );
            store.saveImport(proposal);
          }
          if (command.op === 'applyImport') {
            const original = store.importPreview(command.id);
            // Field corrections are editable; source excerpts and their provenance are immutable.
            if (stable(original.intelligence.evidence) !== stable(command.intelligence.evidence))
              throw new ImportFailure('IMPORT_VALIDATION');
            const critical = criticalReviewIds(
              store.profile(),
              command.intelligence,
              command.facts,
            );
            const reviewed = new Set(command.reviewedCriticalIds ?? []);
            if (command.selectedIds.some((id) => critical.has(id) && !reviewed.has(id)))
              throw new ImportFailure('REVIEW_REQUIRED');
            const known = new Set([
              ...(
                ['skills', 'experience', 'education', 'projects', 'certifications'] as const
              ).flatMap((section) => command.intelligence[section].map((item) => item.id)),
              ...command.facts.map((f) => f.id),
            ]);
            if (command.selectedIds.some((id) => !known.has(id)))
              throw new ImportFailure('IMPORT_VALIDATION');
            const edited = {
              ...original,
              intelligence: command.intelligence,
              facts: command.facts.map((f) => ({ ...f, verified: false })),
            };
            // Profile history and preview status must change together or the import could be applied twice.
            store.commitImport(
              original.id,
              mergeReviewed(store.profile(), edited, command.selectedIds, command.confirmSensitive),
            );
          }
          if (command.op === 'rejectImport') store.rejectImport(command.id);
          if (command.op === 'importRanking') store.importRanking(command.json);
          if (command.op === 'resetRanking') store.resetRanking(command.id, command.presetId);
          if (command.op === 'cloneRanking') store.cloneRanking(command.id, command.name);
          if (command.op === 'saveRanking') store.saveRanking(command.profile);
          if (command.op === 'deleteRanking') store.deleteRanking(command.id);
          if (command.op === 'defaultRanking') store.setDefaultRanking(command.id);
        };
        pending = work();
        await pending;
        return IntelligenceResultSchema.parse({ ok: true, view: view() });
      } catch (error) {
        return IntelligenceResultSchema.parse({
          ok: false,
          code: importFailureCode(
            error,
            command.op === 'assistImport'
              ? 'model'
              : command.op === 'github'
                ? 'source'
                : 'document',
          ),
        });
      } finally {
        if (acquired) {
          busy = false;
          pending = null;
        }
      }
    },
    async shutdown() {
      controller.abort();
      await pending?.catch(() => {});
    },
  };
}
