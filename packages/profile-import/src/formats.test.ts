import { expect, it } from 'vitest';
import { extractFileText, extractDocument, previewDocument } from './index';
import { pdfFixture, zipFixture } from '../../../tests/fixtures/profile-files';
it('extracts actual PDF text locally without OCR or a model', async () => { expect(await extractFileText('pdf', pdfFixture())).toContain('TypeScript'); });
it('extracts bounded DOCX paragraph text and preserves skills/education sections', async () => {
  const file = zipFixture({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>C++ &amp; C#</w:t></w:r></w:p></w:body></w:document>' });
  expect(await extractFileText('docx', file)).toBe('Skills\nC++ & C#\n');
  await expect(extractFileText('docx', zipFixture({ 'word/document.xml': '<!DOCTYPE x><w:t>ignored</w:t>' }))).rejects.toThrow();
});
it('imports user-provided LinkedIn archive CSVs but never fetches a restricted page', async () => {
  const archive = zipFixture({ 'Skills.csv': 'Name\nTypeScript\nPython', 'Positions.csv': 'Company Name,Title,Started On,Finished On,Description\nFixture,Backend Engineer,Jan 2020,Dec 2023,"Used TypeScript, Node.js"', 'Private.csv': 'Gender,Birthday\nprivate,private' });
  const text = await extractFileText('zip', archive); expect(text).not.toContain('Gender');
  const draft = previewDocument(await extractDocument('zip', archive), 'LinkedIn.zip', 'linkedin', '2026-10-17T00:00:00.000Z');
  expect(draft.intelligence.experience[0]!.start).toBe('2020-01'); expect(draft.intelligence.skills.length).toBeGreaterThan(0);
});
it('rejects oversized, corrupt and unsupported files', async () => {
  await expect(extractFileText('txt', Buffer.alloc(5_000_001))).rejects.toThrow();
  await expect(extractFileText('docx', Buffer.from('not a zip'))).rejects.toThrow();
  await expect(extractFileText('exe', Buffer.from('not supported'))).rejects.toThrow();
});
