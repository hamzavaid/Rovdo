import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatUsd } from './presentation';
import { Dashboard } from './Dashboard';
import { BrowserRun } from './BrowserRun';
const settings = { profiles: [], usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, requests: 0, unpricedRequests: 0 } };
it('formats small estimates without falsely rounding nonzero spend to zero', () => {
  expect(formatUsd(0)).toBe('$0.00'); expect(formatUsd(.000042)).toBe('<$0.01'); expect(formatUsd(12.345)).toBe('$12.35');
});
it('shows loading rather than fabricated career metrics on the dashboard', () => {
  const html = renderToStaticMarkup(<Dashboard active settings={settings} navigate={() => {}} />);
  expect(html).toContain('Loading workspace'); expect(html).not.toContain('0 indexed jobs');
  expect(html).toContain('No model connected'); expect(html).toContain('Your profile stays local');
});
it('puts browser task first and scopes advanced controls behind disclosure without dropping consent', () => {
  const html = renderToStaticMarkup(<BrowserRun settings={settings} />);
  expect(html.indexOf('Task<textarea')).toBeLessThan(html.indexOf('Scope and safety settings'));
  expect(html).toContain('Execution limits'); expect(html).toContain('I approve sending this task');
});

it('does not turn unavailable model accounting into zero usage or an unconnected model claim', () => {
  const html = renderToStaticMarkup(<Dashboard active settings={settings} settingsAvailable={false} navigate={() => {}} />);
  expect(html).toContain('Model status unavailable'); expect(html).toContain('Usage unavailable');
  expect(html).not.toContain('No model connected'); expect(html).not.toContain('0 reported tokens');
});
