import { expect, it } from 'vitest';
import { extractDocument, previewDocument, previewText, mergeReviewed } from './index';
import { zipFixture, positionedPdfFixture } from '../../../tests/fixtures/profile-files';
const at = '2026-10-19T00:00:00.000Z';
it('groups technical resume records, preserves evidence and rejects incidental/negated skills', () => {
  const p = previewText(
    'Summary\nI go to a robotics club in Spring. Interested in Rust; no experience with Java.\nTechnical Skills\nC++, SystemVerilog, FreeRTOS, RISC-V, ROS 2\nExperience\nEmbedded Engineer | Anon Devices\nJan 2021 - Dec 2023\nDeveloped C++ drivers on FreeRTOS.\nProjects\nAutonomous Rover\nBuilt ROS 2 navigation using C++.\nTested on hardware.\nEducation\nExample University\nBachelor of Science in Electrical Engineering\nExpected May 2027',
    'technical.txt',
    'file',
    at,
  );
  expect(p.parserVersion).toBe('profile-import-v2');
  expect(p.intelligence.skills.map((s) => s.skillId).sort()).toEqual([
    'cpp',
    'freertos',
    'riscv',
    'ros2',
    'systemverilog',
  ]);
  expect(
    p.intelligence.skills.find((s) => s.skillId === 'cpp')!.evidenceIds.length,
  ).toBeGreaterThan(1);
  expect(p.intelligence.experience).toHaveLength(1);
  expect(p.intelligence.experience[0]).toMatchObject({
    title: 'Embedded Engineer',
    organization: 'Anon Devices',
    start: '2021-01',
    end: '2023-12',
  });
  expect(p.intelligence.projects).toHaveLength(1);
  expect(p.intelligence.projects[0]!.description).toContain('Tested');
  expect(p.intelligence.education[0]).toMatchObject({
    institution: 'Example University',
    status: 'expected',
    graduation: '2027-05',
  });
});
it('maps LinkedIn columns directly and keeps missing end dates unknown', async () => {
  const d = await extractDocument(
    'zip',
    zipFixture({
      'Positions.csv':
        'Company Name,Title,Started On,Finished On,Description\nAnon,Engineer,2021-03,,Built FPGA controls',
      'Education.csv':
        'School Name,Degree Name,Field Of Study,Start Date,End Date\nExample University,Bachelor,Electrical Engineering,2018,2022',
      'Skills.csv': 'Name\nVerilog',
    }),
  );
  expect(d.tables).toHaveLength(3);
  const p = previewDocument(d, 'archive.zip', 'linkedin', at);
  expect(p.intelligence.experience[0]).toMatchObject({ start: '2021-03', end: null });
  expect(p.warnings.join(' ')).toMatch(/end date|ongoing/i);
  expect(p.intelligence.education[0]).toMatchObject({
    institution: 'Example University',
    field: 'Electrical Engineering',
    graduation: '2022',
    status: 'incomplete',
  });
  expect(p.intelligence.evidence.some((e) => e.excerpt.includes('Company Name'))).toBe(true);
});
it('parses DOCX headings, table rows, lists and hyperlink text without fetching links', async () => {
  const xml =
    '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Experience</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Firmware Engineer</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Anon | Jan 2020 - Feb 2022</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:pPr><w:numPr/></w:pPr><w:hyperlink r:id="rId1"><w:r><w:t>Built C++ drivers</w:t></w:r></w:hyperlink></w:p></w:body></w:document>';
  const d = await extractDocument('docx', zipFixture({ 'word/document.xml': xml }));
  expect(d.blocks.map((b) => b.kind)).toEqual(['heading', 'table-row', 'list']);
  expect(previewDocument(d, 'resume.docx', 'file', at).intelligence.experience[0]!.start).toBe(
    '2020-01',
  );
  await expect(
    extractDocument('docx', zipFixture({ 'word/document.xml': '<w:document><w:p></w:document>' })),
  ).rejects.toThrow();
});
it('does not assign projects or dates from another section and reports reversed dates', () => {
  const p = previewText(
    'Experience\nEngineer | Anon | 2024 - 2020\nProjects\nServo controller\nC++ firmware\nEducation\nBachelor in Engineering | Example | Expected 2027',
    'x',
    'file',
    at,
  );
  expect(p.intelligence.experience[0]!.start).toBeNull();
  expect(p.warnings.join(' ')).toMatch(/date/i);
  expect(p.intelligence.projects).toHaveLength(1);
  expect(p.intelligence.experience[0]!.skills).not.toContain('cpp');
});
it('merges reimports by canonical identity, links evidence, and never overwrites verified originals', () => {
  const a = previewText('Skills\nC++\nProjects\nController | C++ firmware', 'a', 'file', at);
  const base = mergeReviewed(
    null,
    a,
    [...a.intelligence.skills, ...a.intelligence.projects].map((s) => s.id),
    false,
  );
  const b = previewText(
    'Skills\nC++\nProjects\nController | C++ firmware\nTested on Linux',
    'b',
    'file',
    at,
  );
  const result = mergeReviewed(
    base,
    b,
    [...b.intelligence.skills, ...b.intelligence.projects].map((s) => s.id),
    false,
  );
  expect(result.intelligence!.skills.filter((s) => s.skillId === 'cpp')).toHaveLength(1);
  expect(result.intelligence!.projects).toHaveLength(1);
  expect(result.intelligence!.projects[0]!.description).toBe(
    base.intelligence!.projects[0]!.description,
  );
  expect(result.intelligence!.skills[0]!.evidenceIds.length).toBeGreaterThan(
    base.intelligence!.skills[0]!.evidenceIds.length,
  );
  expect(
    mergeReviewed(
      result,
      b,
      b.intelligence.skills.map((s) => s.id),
      false,
    ).intelligence!.skills,
  ).toEqual(result.intelligence!.skills);
});
it('keeps unsupported custom declared skills as proposals without inferring proficiency', () => {
  const p = previewText(
    'Technical Skills\nZephyr RTOS, CustomLabTool\nInterests\nI like to go hiking in Spring',
    'x',
    'file',
    at,
  );
  expect(
    p.intelligence.skills.some(
      (s) => s.skillId === 'custom:customlabtool' && !s.verified && s.recognition === 'explicit',
    ),
  ).toBe(true);
  expect(p.intelligence.skills.some((s) => ['go', 'spring'].includes(s.skillId))).toBe(false);
});

it('keeps unknown employment ends out of duration scoring', async () => {
  const { unionMonths } = await import('@rovdo/career');
  expect(unionMonths([{ start: '2020-01', end: null, ongoing: false }], '2026-01-01')).toBe(0);
});

it('recovers positioned two-column PDF sections without mixing sidebar dates into employment', async () => {
  const d = await extractDocument(
    'pdf',
    positionedPdfFixture([
      { text: 'Technical Skills', x: 40, y: 740 },
      { text: 'C++, Verilog', x: 40, y: 720 },
      { text: 'FreeRTOS', x: 40, y: 700 },
      { text: 'Education', x: 40, y: 660 },
      { text: 'Example University', x: 40, y: 640 },
      { text: 'Bachelor in Engineering', x: 40, y: 620 },
      { text: 'Expected May 2027', x: 40, y: 600 },
      { text: 'Experience', x: 320, y: 740 },
      { text: 'Firmware Engineer | Anon', x: 320, y: 720 },
      { text: 'Jan 2021 - Dec 2023', x: 320, y: 700 },
      { text: 'Developed C++ drivers.', x: 320, y: 680 },
      { text: 'Projects', x: 320, y: 640 },
      { text: 'Servo Controller', x: 320, y: 620 },
      { text: 'Built Verilog modules.', x: 320, y: 600 },
    ]),
  );
  expect(d.blocks.some((b) => b.column === 2 && typeof b.x === 'number')).toBe(true);
  const p = previewDocument(d, 'columns.pdf', 'file', at);
  expect(p.intelligence.experience[0]).toMatchObject({ start: '2021-01', end: '2023-12' });
  expect(p.intelligence.projects).toHaveLength(1);
  expect(p.intelligence.evidence.some((e) => e.location?.includes('column:2'))).toBe(true);
});
it('reports field-level precision/recall on a labeled anonymized regression corpus', () => {
  const corpus = [
    {
      text: 'Technical Skills\nC++, FreeRTOS, Verilog\nExperience\nFirmware Engineer | Acme | Jan 2021 - Dec 2023\nDeveloped C++ firmware.\nProjects\nController | Built Verilog logic',
      skills: ['cpp', 'freertos', 'verilog'],
      dates: ['2021-01', '2023-12'],
    },
    {
      text: 'Skills\nPython, ROS 2, OpenCV\nExperience\nRobotics Engineer | Anon | Mar 2020 - Present\nUsed Python and OpenCV.\nProjects\nRover | Built ROS 2 controls',
      skills: ['python', 'ros2', 'opencv'],
      dates: ['2020-03', null],
    },
    {
      text: 'Summary\nI go hiking in Spring and want to learn Java.\nTechnical Skills\nTypeScript, Node.js, PostgreSQL\nExperience\nBackend Engineer | Sample | 2022-03 - 2024-02\nBuilt TypeScript services.',
      skills: ['typescript', 'nodejs', 'postgresql'],
      dates: ['2022-03', '2024-02'],
    },
  ];
  let tp = 0,
    fp = 0,
    fn = 0,
    dateTp = 0,
    dateFp = 0,
    dateFn = 0;
  for (const fixture of corpus) {
    const p = previewText(fixture.text, 'fixture', 'file', at);
    const actual = new Set(p.intelligence.skills.map((s) => s.skillId));
    tp += fixture.skills.filter((s) => actual.has(s)).length;
    fp += [...actual].filter((s) => !fixture.skills.includes(s)).length;
    fn += fixture.skills.filter((s) => !actual.has(s)).length;
    const work = p.intelligence.experience[0];
    for (const [i, value] of [work?.start, work?.end].entries()) {
      if (value === fixture.dates[i]) dateTp++;
      else {
        if (value) dateFp++;
        if (fixture.dates[i]) dateFn++;
      }
    }
  }
  const metrics = {
    skills: { precision: tp / (tp + fp), recall: tp / (tp + fn), falsePositives: fp },
    employmentDates: {
      precision: dateTp / (dateTp + dateFp),
      recall: dateTp / (dateTp + dateFn),
      incorrect: dateFp,
    },
  };
  // eslint-disable-next-line no-console -- Emit measured regression-corpus metrics for delivery records.
  console.info('Profile Import v2 provisional regression metrics', JSON.stringify(metrics));
  expect(metrics.skills.precision).toBe(1);
  expect(metrics.skills.recall).toBe(1);
  expect(metrics.employmentDates.incorrect).toBe(0);
  expect(metrics.employmentDates.recall).toBe(1);
});

it('retains incomplete qualifications, groups certificate issuer/expiry and rejects invalid calendar dates', () => {
  const p = previewText(
    'Experience\nEngineer | Anon | 2022-13 - 2024-02\nCertifications\nEmbedded Systems Certificate\nExample Board\nExpires May 2027\n\nHardware Safety License | Sample Board | expires June 2028',
    'x',
    'file',
    at,
  );
  expect(p.intelligence.experience[0]!.start).toBeNull();
  expect(p.intelligence.certifications).toHaveLength(2);
  expect(p.intelligence.certifications[0]).toMatchObject({
    name: 'Embedded Systems Certificate',
    issuer: 'Example Board',
    expires: '2027-05',
  });
});

it('extracts education tables in either column order without treating degrees or dates as schools', async () => {
  const document = await extractDocument(
    'docx',
    zipFixture({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Education</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Example University</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Bachelor in Electrical Engineering</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Expected May 2027</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    }),
  );
  const p = previewDocument(document, 'education.docx', 'file', at);
  expect(p.intelligence.education[0]).toMatchObject({
    institution: 'Example University',
    field: 'Electrical Engineering',
    status: 'expected',
    graduation: '2027-05',
  });
  const missing = previewText(
    'Education\nBachelor in Engineering | Expected May 2027',
    'x',
    'file',
    at,
  );
  expect(missing.intelligence.education[0]!.institution).toBe('');
  expect(missing.warnings.join(' ')).toMatch(/institution|school/i);
});

it('recognizes standalone LinkedIn education and certification CSVs by headers without making credential names into skills', async () => {
  const education = previewDocument(
    await extractDocument(
      'csv',
      Buffer.from(
        'School Name,Degree Name,Field Of Study,End Date\nExample University,Bachelor,Engineering,2027',
      ),
    ),
    'Education.csv',
    'linkedin',
    at,
  );
  expect(education.intelligence.education).toHaveLength(1);
  expect(education.intelligence.skills).toHaveLength(0);
  const certificate = previewDocument(
    await extractDocument(
      'csv',
      Buffer.from('Name,Authority,Finished On\nHardware Safety,Example Board,May 2027'),
    ),
    'Certifications.csv',
    'linkedin',
    at,
  );
  expect(certificate.intelligence.certifications).toHaveLength(1);
  expect(certificate.intelligence.skills).toHaveLength(0);
});

it('does not propose negated skills from an explicit skills list', () => {
  const p = previewText(
    'Skills\nPython; no Java; never used Rust; not familiar with ARM',
    'x',
    'file',
    at,
  );
  expect(p.intelligence.skills.map((s) => s.skillId)).toEqual(['python']);
});
