import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobsWorkspace } from './JobsWorkspace';
const settings = {
  profiles: [],
  usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, requests: 0, unpricedRequests: 0 },
};
it('provides five native pages without fabricated jobs, scores or coverage', () => {
  const html = renderToStaticMarkup(<JobsWorkspace settings={settings} />);
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  expect(nav.match(/<button/g)).toHaveLength(5);
  for (const label of [
    'Find Jobs',
    'Saved Jobs',
    'Ranking Methods',
    'Scope &amp; Collection',
    'Companies',
  ])
    expect(nav).toContain(label);
  expect(html).toContain('Loading indexed jobs');
  expect(html).not.toContain('Example Robotics');
  expect(html).not.toContain('Sample calculation');
});
it('does not show Find controls or collection activity on Saved Jobs', () => {
  const html = renderToStaticMarkup(<JobsWorkspace settings={settings} initialSavedOnly />);
  expect(html).not.toContain('aria-label="Discovery progress"');
  expect(html).not.toContain('Job title, keyword, or company');
  expect(html).not.toContain('No saved jobs yet');
});
