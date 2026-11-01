import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatUsd } from './presentation';
import { Dashboard } from './Dashboard';
import { BrowserRun } from './BrowserRun';
import { Models } from './Models';
import { CliModels } from './CliModels';
import { Chat } from './Chat';
import type { CliView } from '@rovdo/shared';
const settings = {
  profiles: [],
  usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, requests: 0, unpricedRequests: 0 },
};
const cli: CliView = {
  id: 'claude',
  profileId: '9b1b7310-0604-4aaa-8000-000000000002',
  name: 'Claude Code',
  version: '2.1.248',
  status: 'connected',
  model: 'sonnet',
  models: [],
  timeoutMs: 60000,
  text: 'supported',
  streaming: 'supported',
  revision: 1,
};
it('shows CLI readiness in the dashboard and keeps API onboarding optional', () => {
  const connected = { ...settings, clis: [cli] };
  const dashboard = renderToStaticMarkup(
    <Dashboard settings={connected} active navigate={() => {}} />,
  );
  expect(dashboard).toContain('1 ready for chat');
  expect(dashboard).not.toContain('No model connected');
  const models = renderToStaticMarkup(
    <Models settings={connected} active={false} refresh={async () => {}} />,
  );
  expect(models).toContain('Add an API model (optional)');
  expect(models).not.toContain('Connect your first model');
  const chat = renderToStaticMarkup(
    <Chat settings={connected} refresh={async () => {}} onConfigure={() => {}} />,
  );
  expect(chat).toContain('CLI · Claude Code · sonnet');
});
it('renders honest capability/cost states and safe disclosure controls for CLI connections', () => {
  const html = renderToStaticMarkup(
    <CliModels views={[cli]} active={false} refresh={async () => {}} />,
  );
  expect(html).toContain('Connect your CLI');
  expect(html).toContain('Cost unknown');
  expect(html).toContain('API spending');
  expect(html).toContain('Configure Claude Code');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('Free');
});
it('formats small estimates without falsely rounding nonzero spend to zero', () => {
  expect(formatUsd(0)).toBe('$0.00');
  expect(formatUsd(0.000042)).toBe('<$0.01');
  expect(formatUsd(12.345)).toBe('$12.35');
});
it('shows loading rather than fabricated career metrics on the dashboard', () => {
  const html = renderToStaticMarkup(<Dashboard active settings={settings} navigate={() => {}} />);
  expect(html).toContain('Loading workspace');
  expect(html).not.toContain('0 indexed jobs');
  expect(html).toContain('No model connected');
  expect(html).toContain('Your profile stays local');
});
it('puts browser task first and scopes advanced controls behind disclosure without dropping consent', () => {
  const html = renderToStaticMarkup(<BrowserRun settings={settings} />);
  expect(html.indexOf('Task<textarea')).toBeLessThan(html.indexOf('Scope and safety settings'));
  expect(html).toContain('Execution limits');
  expect(html).toContain('I approve sending this task');
});

it('does not turn unavailable model accounting into zero usage or an unconnected model claim', () => {
  const html = renderToStaticMarkup(
    <Dashboard active settings={settings} settingsAvailable={false} navigate={() => {}} />,
  );
  expect(html).toContain('Model status unavailable');
  expect(html).toContain('Usage unavailable');
  expect(html).not.toContain('No model connected');
  expect(html).not.toContain('0 reported tokens');
});
