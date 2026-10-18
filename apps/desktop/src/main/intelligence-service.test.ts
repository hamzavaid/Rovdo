import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { previewText } from '@rovdo/profile-import';
import { createIntelligenceService } from './intelligence-service';
const sender = { url: 'rovdo://app/index.html', isMainFrame: true, ownsWindow: true };
it('guards import capabilities, saves previews and explicitly confirms sensitive facts', async () => {
  const store = new CareerStore(':memory:'); let choices = 0;
  const service = createIntelligenceService(store, async () => { choices++; return previewText('Skills\nPython\nCitizenship: US', 'resume.txt', 'file', '2026-10-17T00:00:00.000Z'); });
  try {
    expect(await service.command({ op: 'importFile' }, { ...sender, ownsWindow: false })).toEqual({ ok: false, code: 'IPC_FORBIDDEN' }); expect(choices).toBe(0);
    expect(await service.command({ op: 'importFile', path: 'C:/private' }, sender)).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    const response = await service.command({ op: 'importFile' }, sender); expect(response.ok).toBe(true); if (!response.ok) return;
    expect(store.profile()).toBeNull(); const draft = response.view.previews[0]!;
    const applied = await service.command({ op: 'applyImport', id: draft.id, intelligence: draft.intelligence, facts: draft.facts, selectedIds: [...draft.intelligence.skills.map((s) => s.id), ...draft.facts.map((f) => f.id)], confirmSensitive: false }, sender);
    expect(applied.ok).toBe(true); expect(store.profile()!.facts.find((f) => f.field === 'citizenship')!.verified).toBe(false);
    expect(store.profile()!.intelligence!.skills[0]!.verified).toBe(true);
    expect((await service.command({ op: 'applyImport', id: draft.id, intelligence: draft.intelligence, facts: draft.facts, selectedIds: [], confirmSensitive: true }, sender)).ok).toBe(false);
  } finally { await service.shutdown(); store.close(); }
});
it('keeps the busy guard held when another import command is rejected', async () => {
  const store = new CareerStore(':memory:'); let release: () => void = () => {}; let calls = 0;
  const service = createIntelligenceService(store, async () => { calls++; await new Promise<void>((r) => { release = r; }); return null; });
  try {
    const pending = service.command({ op: 'importFile' }, sender);
    expect(await service.command({ op: 'importFile' }, sender)).toEqual({ ok: false, code: 'BUSY' });
    expect(await service.command({ op: 'importFile' }, sender)).toEqual({ ok: false, code: 'BUSY' });
    expect(calls).toBe(1); release(); await pending;
  } finally { release(); await service.shutdown(); store.close(); }
});
