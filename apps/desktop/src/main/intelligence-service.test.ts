import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { previewText } from '@rovdo/profile-import';
import { createIntelligenceService } from './intelligence-service';
const sender = { url: 'rovdo://app/index.html', isMainFrame: true, ownsWindow: true };
it('validates and persists appearance independently of provider and profile data', async () => {
  const store = new CareerStore(':memory:'); const changes: string[] = [];
  const service = createIntelligenceService(store, async () => null, (mode) => changes.push(mode));
  try {
    expect(await service.command({ op: 'appearance', mode: 'invalid' }, sender)).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await service.command({ op: 'appearance', mode: 'dark' }, { ...sender, ownsWindow: false })).toEqual({ ok: false, code: 'IPC_FORBIDDEN' });
    const result = await service.command({ op: 'appearance', mode: 'dark' }, sender);
    expect(result.ok && result.view.appearance).toBe('dark'); expect(changes).toEqual(['dark']);
    expect(store.setting('appearance')).toBe('dark'); expect(store.profile()).toBeNull();
  } finally { await service.shutdown(); store.close(); }
});
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

it('requires individual review acknowledgements for critical imported qualifications',async()=>{const store=new CareerStore(':memory:');const draft=previewText('Experience\nFirmware Engineer | Example | Jan 2020 - Dec 2023\nEducation\nCompleted Bachelor in Engineering | Example University | 2024','resume','file','2026-10-20T00:00:00.000Z');store.saveImport(draft);const service=createIntelligenceService(store,async()=>null);const selectedIds=[...draft.intelligence.experience,...draft.intelligence.education].map(q=>q.id);try{const command={op:'applyImport',id:draft.id,intelligence:draft.intelligence,facts:[],selectedIds,confirmSensitive:false};const blocked=await service.command(command,sender);expect(blocked).toEqual({ok:false,code:'REVIEW_REQUIRED'});expect(store.profile()).toBeNull();const applied=await service.command({...command,reviewedCriticalIds:selectedIds},sender);expect(applied.ok).toBe(true);expect(store.profile()!.intelligence!.experience[0]!.verified).toBe(true);}finally{await service.shutdown();store.close();}});
it.each([['UNSUPPORTED_FILE','UNSUPPORTED_FILE'],['SCANNED_PDF','SCANNED_PDF'],['INVALID_XML','MALFORMED_DOCUMENT'],['PDF_TIMEOUT','IMPORT_TIMEOUT']])('returns actionable %s failures and recovers without leaking file paths',async(raw,code)=>{const store=new CareerStore(':memory:');let failed=true;const service=createIntelligenceService(store,async()=>{if(failed)throw new Error(raw);return null;});try{expect(await service.command({op:'importFile'},sender)).toEqual({ok:false,code});expect(store.profile()).toBeNull();failed=false;expect((await service.command({op:'importFile'},sender)).ok).toBe(true);}finally{await service.shutdown();store.close();}});

it('rejects renderer changes to immutable import excerpts before verification',async()=>{const store=new CareerStore(':memory:');const draft=previewText('Skills\nTypeScript','resume','file','2026-10-20T00:00:00.000Z');store.saveImport(draft);const edited=structuredClone(draft.intelligence);edited.evidence[0]!.excerpt='Invented credential';const service=createIntelligenceService(store,async()=>null);try{expect(await service.command({op:'applyImport',id:draft.id,intelligence:edited,facts:[],selectedIds:edited.skills.map(s=>s.id),confirmSensitive:false},sender)).toEqual({ok:false,code:'IMPORT_VALIDATION'});expect(store.profile()).toBeNull();}finally{await service.shutdown();store.close();}});

it('requires individual review for imported legacy employment facts too',async()=>{const store=new CareerStore(':memory:');const draft=previewText('Skills\nPython','resume','file','2026-10-20T00:00:00.000Z');draft.facts.push({id:'legacy-work',field:'experience',value:'Engineer at Sample Labs',verified:false,source:{kind:'document',reference:'Imported resume',capturedAt:draft.source.capturedAt}});store.saveImport(draft);const service=createIntelligenceService(store,async()=>null);try{const cmd={op:'applyImport',id:draft.id,intelligence:draft.intelligence,facts:draft.facts,selectedIds:['legacy-work'],confirmSensitive:false};expect(await service.command(cmd,sender)).toEqual({ok:false,code:'REVIEW_REQUIRED'});expect((await service.command({...cmd,reviewedCriticalIds:['legacy-work']},sender)).ok).toBe(true);}finally{await service.shutdown();store.close();}});
