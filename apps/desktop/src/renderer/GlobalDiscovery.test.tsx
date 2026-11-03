import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalDiscovery, defaultDiscovery } from './GlobalDiscovery';
it('offers only supported zero-configuration discovery', () => {
  const html = renderToStaticMarkup(
    <GlobalDiscovery
      options={defaultDiscovery}
      onOptions={() => {}}
      view={undefined}
      command={async () => {}}
      busy={false}
    />,
  );
  expect(html).not.toContain('SearXNG');
  expect(html).not.toContain('Python');
  expect(defaultDiscovery.sourceIds).toContain('wayback');
});
it('warns when selected ATS adapters depend only on archive indexes and offers recovery', () => {
  const html = renderToStaticMarkup(
    <GlobalDiscovery
      options={{ sourceIds: ['lever', 'wayback', 'common-crawl'], overrides: {} }}
      onOptions={() => {}}
      view={undefined}
      command={async () => {}}
      busy={false}
    />,
  );
  expect(html).toContain('Archive-only discovery');
  expect(html).toContain('Search with recommended sources');
});
