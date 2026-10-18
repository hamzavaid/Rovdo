import { _electron as electron, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pdfFixture, zipFixture } from '../fixtures/profile-files';

test('imports PDF and DOCX through the native file capability and bounded worker', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const desktop = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('user-data')}`], env });
  try {
    const page = await desktop.firstWindow();
    for (const [extension, bytes] of [ ['pdf', pdfFixture()], ['docx', zipFixture({ 'word/document.xml': '<w:document><w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>Python and PostgreSQL</w:t></w:r></w:p></w:document>' })] ] as const) {
      const path = test.info().outputPath(`resume.${extension}`); await writeFile(path, bytes);
      await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path);
      const result = await page.evaluate(() => window.rovdo!.intelligenceCommand({ op: 'importFile' }));
      expect(result.ok).toBe(true); if (!result.ok) continue;
      expect(result.view.previews[0]!.intelligence.skills.length).toBeGreaterThan(0);
      expect(result.view.previews[0]!.intelligence.skills.every((s) => !s.verified)).toBe(true);
      expect(result.view.profile).toBeNull(); expect(JSON.stringify(result.view.previews[0])).not.toContain(test.info().outputDir);
    }
  } finally { await desktop.close(); }
});
