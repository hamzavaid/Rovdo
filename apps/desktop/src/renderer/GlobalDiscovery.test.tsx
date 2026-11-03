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
