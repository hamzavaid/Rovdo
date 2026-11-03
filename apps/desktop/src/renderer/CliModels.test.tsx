import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CliViewSchema } from '@rovdo/shared';
import { CliModels } from './CliModels';
it('renders one compact provider card with backend permission state even if duplicate status entries arrive', () => {
  const cli = CliViewSchema.parse({
    id: 'codex',
    profileId: '9b1b7310-0604-4aaa-8000-000000000001',
    name: 'OpenAI Codex',
    version: '0.165.0',
    status: 'connected',
    model: '',
    models: [],
    timeoutMs: 60000,
    text: 'supported',
    streaming: 'unknown',
    revision: 1,
    authorization: { chat: true, selectedFiles: false },
  });
  const html = renderToStaticMarkup(
    <CliModels views={[cli, cli]} active={false} refresh={async () => {}} />,
  );
  expect(html.match(/aria-label="OpenAI Codex"/g)).toHaveLength(1);
  expect(html).toContain('Manage permissions');
  expect(html).toContain('Revoke access');
  expect(html).toContain('Chat approved');
});
