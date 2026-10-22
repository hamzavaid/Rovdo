import { _electron as electron, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pdfFixture, zipFixture } from '../fixtures/profile-files';

test('imports PDF and DOCX through the native file capability and bounded worker', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const desktop = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('user-data')}`],
    env,
  });
  try {
    const page = await desktop.firstWindow();
    const transcriptPath = test.info().outputPath('transcript.csv');
    await writeFile(
      transcriptPath,
      'Course Code,Course Title,Credits,Grade\nCS101,Computing fundamentals,3,A\nCS220,Embedded systems,3,IP',
    );
    await desktop.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, transcriptPath);
    const transcript = await page.evaluate(() =>
      window.rovdo!.intelligenceCommand({ op: 'importTranscript' }),
    );
    expect(transcript.ok).toBe(true);
    if (transcript.ok) {
      const proposal = transcript.view.previews[0]!.intelligence;
      expect(proposal.education[0]!.coursework).toHaveLength(2);
      expect(proposal.education[0]!.verified).toBe(false);
      expect(proposal.education[0]!.graduation).toBeNull();
      expect(proposal.skills).toHaveLength(0);
    }
    for (const [extension, bytes] of [
      ['pdf', pdfFixture()],
      [
        'docx',
        zipFixture({
          'word/document.xml':
            '<w:document><w:body><w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>Python and PostgreSQL</w:t></w:r></w:p></w:body></w:document>',
        }),
      ],
    ] as const) {
      const path = test.info().outputPath(`resume.${extension}`);
      await writeFile(path, bytes);
      await desktop.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, path);
      const result = await page.evaluate(() =>
        window.rovdo!.intelligenceCommand({ op: 'importFile' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.view.previews[0]!.intelligence.skills.length).toBeGreaterThan(0);
      expect(result.view.previews[0]!.intelligence.skills.every((s) => !s.verified)).toBe(true);
      expect(result.view.profile).toBeNull();
      expect(JSON.stringify(result.view.previews[0])).not.toContain(test.info().outputDir);
    }
  } finally {
    await desktop.close();
  }
});

test('shows actionable file errors and recovers through the isolated worker', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('error-data')}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Imports', exact: true }).click();
    const cases = [
      ['unsupported.exe', Buffer.from('no'), 'Choose a supported'],
      ['scanned.pdf', pdfFixture([]), 'no readable text'],
      ['malformed.docx', Buffer.from('not a zip'), 'damaged or malformed'],
    ] as const;
    for (const [name, bytes, message] of cases) {
      const file = test.info().outputPath(name);
      await writeFile(file, bytes);
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await page.getByRole('button', { name: 'Choose profile file' }).click();
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByRole('button', { name: 'Choose profile file' })).toBeEnabled();
    }
    const file = test.info().outputPath('recovered.pdf');
    await writeFile(file, pdfFixture());
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await page.getByRole('button', { name: 'Choose profile file' }).click();
    await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('keeps conflicting employment proposals separate until an individual version is approved', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('conflict-data')}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    const file = test.info().outputPath('conflicts.zip');
    await writeFile(
      file,
      zipFixture({
        'Positions.csv':
          'Company Name,Title,Started On,Finished On,Description\nSample Labs,Engineer,2020-01,2023-12,Controls\nSample Labs,Engineer,2020-01,2024-12,Controls',
      }),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Imports', exact: true }).click();
    await page.getByRole('button', { name: 'Choose profile file' }).click();
    await page.getByRole('button', { name: 'Experience (2)', exact: true }).click();
    const rows = page.getByRole('button', { name: /Review Engineer imported experience/ });
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await rows.nth(i).click();
      await page
        .getByLabel('I individually reviewed this qualification and its source evidence')
        .check();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Continue to confirmation' }).click();
    await page
      .getByLabel('I reviewed the selected qualifications and their source evidence')
      .check();
    await page.getByRole('button', { name: 'Verify selected and merge' }).click();
    await expect(page.getByRole('alert')).toContainText('Resolve conflicting selections');
    await page.getByRole('button', { name: 'Back to review' }).click();
    await page.getByLabel('Verify experience 2', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Continue to confirmation' }).click();
    await page
      .getByLabel('I reviewed the selected qualifications and their source evidence')
      .check();
    await page.getByRole('button', { name: 'Verify selected and merge' }).click();
    await expect(page.getByText('Profile version 1', { exact: true })).toBeVisible();
    const result = await page.evaluate(() => window.rovdo!.intelligenceCommand({ op: 'view' }));
    expect(result.ok && result.view.profile!.intelligence!.experience).toHaveLength(1);
  } finally {
    await app.close();
  }
});
