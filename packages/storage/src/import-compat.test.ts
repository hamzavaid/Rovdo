import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { previewText } from '@rovdo/profile-import';
import { sampleCandidate } from '../../../tests/fixtures/ranking-v2';
it('reopens original profiles, ranking defaults and v1 previews without rewriting stored evidence',()=>{const dir=mkdtempSync(join(tmpdir(),'rovdo-import-compat-'));const path=join(dir,'data.sqlite');let store=new CareerStore(path);try{const profile=sampleCandidate();store.saveProfile(profile);const preview={...previewText('Skills\nTypeScript','old','file','2026-10-19T00:00:00.000Z'),parserVersion:'profile-import-v1' as const};store.saveImport(preview);const ranking=store.cloneRanking('builtin:technical-balanced','Saved before v2');store.setDefaultRanking(ranking.id);store.close();store=new CareerStore(path);expect(store.profile()).toEqual(profile);expect(store.importPreview(preview.id).parserVersion).toBe('profile-import-v1');expect(store.defaultRanking()).toBe(ranking.id);expect(store.profile()!.intelligence!.skills[0]!.evidenceIds).toEqual(profile.intelligence!.skills[0]!.evidenceIds);}finally{store.close();rmSync(dir,{recursive:true,force:true});}});
