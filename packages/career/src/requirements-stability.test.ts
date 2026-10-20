import { expect, it } from 'vitest';
import { extractRequirements } from './requirements';
it('keeps required/preferred clauses distinct and does not turn negations into requirements', () => {
  const text =
    'Required Qualifications\nPython required; Java preferred\nRust is not required\nNo degree required\nAWS or Azure required';
  const r = extractRequirements(text, 'Engineer');
  expect(r.items.find((x) => x.skillId === 'python')?.importance).toBe('required');
  expect(r.items.find((x) => x.skillId === 'java')?.importance).toBe('preferred');
  expect(r.items.some((x) => x.skillId === 'rust' || x.kind === 'education')).toBe(false);
  expect(r.items.find((x) => x.skillId === 'aws')?.alternatives).toEqual(['azure']);
  expect(r.items.every((x) => text.slice(x.start, x.end) === x.excerpt)).toBe(true);
});
it('takes the longest overlapping alias without inventing extra required technologies', () => {
  const r = extractRequirements(
    'Required skills: C++, ROS 2, Embedded Linux, Node.js',
    'Robotics Engineer',
  );
  const ids = r.items.filter((x) => x.kind === 'skill').map((x) => x.skillId);
  expect(ids).toContain('cpp');
  expect(ids).toContain('ros2');
  expect(ids).not.toContain('c');
  expect(ids).not.toContain('ros');
  expect(ids).not.toContain('linux');
  expect(ids.filter((x) => x === 'nodejs')).toHaveLength(1);
});
it('handles contrasts and leaves ambiguous postings reviewable without invented hard gates', () => {
  const r = extractRequirements(
    'Python not required, but TypeScript required\nQualifications\nFamiliarity with FPGA may help',
    'Engineer',
  );
  expect(r.items.some((x) => x.skillId === 'python')).toBe(false);
  expect(r.items.find((x) => x.skillId === 'typescript')?.importance).toBe('required');
  expect(r.items.find((x) => x.skillId === 'fpga')?.importance).toBe('ambiguous');
});
it('reports provisional field-level requirement labels without accuracy claims', () => {
  const fixture = [
    ['Python required; Java preferred', ['python:required', 'java:preferred']],
    ['No Rust experience required', []],
    ['C++ required', ['cpp:required']],
    ['AWS or Azure preferred', ['aws:preferred']],
  ] as const;
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const [text, expected] of fixture) {
    const got = extractRequirements(text, 'Engineer')
      .items.filter((x) => x.kind === 'skill')
      .map((x) => `${x.skillId}:${x.importance}`);
    tp += got.filter((x) => (expected as readonly string[]).includes(x)).length;
    fp += got.filter((x) => !(expected as readonly string[]).includes(x)).length;
    fn += expected.filter((x) => !got.includes(x)).length;
  }
  expect({ precision: tp / (tp + fp), recall: tp / (tp + fn), falsePositives: fp }).toEqual({
    precision: 1,
    recall: 1,
    falsePositives: 0,
  });
});

it('does not interpret prohibited or explicitly unnecessary technologies as qualifications', () => {
  const r = extractRequirements(
    'Required Qualifications\nC++ required but not Rust\nJava is not a prerequisite\nMust not use Python\nSQL required',
    'Engineer',
  );
  expect(r.items.filter((r) => r.kind === 'skill').map((r) => r.skillId)).toEqual(['cpp', 'sql']);
});
