import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkillsPanel } from './SkillsPanel';
import { sampleCandidate } from '../../../../tests/fixtures/ranking-v2';
it('shows real skills as searchable grouped chips without expanding every editor', () => {
  const html = renderToStaticMarkup(<SkillsPanel profile={sampleCandidate()} onUpdate={() => {}} onAdd={() => {}} />);
  expect(html).toContain('Search your skills'); expect(html).toContain('Programming'); expect(html).toContain('TypeScript');
  expect(html).toContain('Edit TypeScript skill'); expect(html).not.toContain('Source evidence');
  expect(html).not.toContain('Verilog');
});
