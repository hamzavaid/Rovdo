import { expect, it } from 'vitest';
import { textDocument } from './document';
import { previewTranscript, transcriptDocument } from './transcript';
import { positionedPdfFixture, zipFixture } from '../../../tests/fixtures/profile-files';
const at = '2026-10-22T00:00:00.000Z';
it('preserves transcript coursework without inventing degree completion, professional skills or dates', () => {
  const p = previewTranscript(
    textDocument(
      'Example University\nProgram: Bachelor of Science in Computer Engineering\nCourse Code | Course Title | Term | Credits | Grade\nCS101 | Programming with C++ | Fall 2025 | 3 | A\nCS101 | Programming with C++ | Fall 2025 | 3 | A\nCS220 | Operating Systems | Spring 2026 | 4 | IP',
    ),
    'transcript.txt',
    at,
  );
  expect(p.intelligence.education[0]).toMatchObject({
    institution: 'Example University',
    status: 'incomplete',
    graduation: null,
    verified: false,
  });
  expect(p.intelligence.education[0]!.coursework).toHaveLength(2);
  expect(p.intelligence.skills).toHaveLength(0);
  expect(p.intelligence.experience).toHaveLength(0);
});
it('reads CSV column names directly and keeps awarded degrees distinct from course dates', async () => {
  const d = await transcriptDocument(
    'csv',
    Buffer.from('Course Code,Course Title,Credits,Grade\nEE201,Digital Logic,3,B+'),
  );
  const p = previewTranscript(d, 'transcript.csv', at);
  expect(p.intelligence.education[0]!.coursework![0]).toContain('Digital Logic');
  expect(p.intelligence.education[0]!.institution).toBe('');
  expect(p.warnings.join(' ')).toMatch(/institution/i);
});
it('does not interpret negative degree-award fields as completed education', () => {
  for (const award of ['None', 'Not awarded', 'N/A', 'Pending', 'Not yet conferred']) {
    const p = previewTranscript(
      textDocument(
        `Example University\nDegree awarded: ${award}\nGraduation date: 2027\nCourse Code | Course Title\nEE101 | Digital Logic`,
      ),
      'transcript.txt',
      at,
    );
    expect(p.intelligence.education[0]).toMatchObject({ status: 'incomplete', graduation: null });
  }
});
it('preserves positioned PDF cells and OOXML transcript table columns', async () => {
  const pdf = positionedPdfFixture([
    { text: 'Example University', x: 72, y: 740 },
    { text: 'Course Code', x: 72, y: 700 },
    { text: 'Course Title', x: 230, y: 700 },
    { text: 'Credits', x: 490, y: 700 },
    { text: 'CS101', x: 72, y: 680 },
    { text: 'Computing fundamentals', x: 230, y: 680 },
    { text: '3', x: 490, y: 680 },
    { text: 'EE201', x: 72, y: 660 },
    { text: 'Digital Logic', x: 230, y: 660 },
    { text: '4', x: 490, y: 660 },
  ]);
  const docx = zipFixture({
    'word/document.xml':
      '<w:document><w:body><w:p><w:r><w:t>Example University</w:t></w:r></w:p><w:tbl>' +
      [
        ['Course Code', 'Course Title', 'Credits'],
        ['CS101', 'Computing fundamentals', '3'],
        ['EE201', 'Digital Logic', '4'],
      ]
        .map(
          (row) =>
            '<w:tr>' +
            row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('') +
            '</w:tr>',
        )
        .join('') +
      '</w:tbl></w:body></w:document>',
  });
  for (const [format, bytes] of [
    ['pdf', pdf],
    ['docx', docx],
  ] as const) {
    const p = previewTranscript(
      await transcriptDocument(format, bytes),
      'transcript.' + format,
      at,
    );
    expect(p.intelligence.education[0]!.coursework).toHaveLength(2);
    expect(p.intelligence.skills).toHaveLength(0);
  }
});
