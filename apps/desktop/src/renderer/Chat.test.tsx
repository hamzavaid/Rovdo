import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chat } from './Chat';
it('prioritizes conversation with a top selector, bottom composer and explicit attachment/dictation controls', () => {
  const html = renderToStaticMarkup(
    <Chat
      settings={{
        profiles: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          estimatedUsd: 0,
          requests: 0,
          unpricedRequests: 0,
        },
      }}
      refresh={async () => {}}
      onConfigure={() => {}}
      visible={false}
    />,
  );
  expect(html).toContain('+ New chat');
  expect(html).toContain('aria-label="Model profile"');
  expect(html.indexOf('class="transcript"')).toBeLessThan(html.indexOf('class="composer"'));
  expect(html).toContain('aria-label="Attach files or folders"');
  expect(html).toContain('aria-label="Start dictation"');
  expect(html).not.toContain('A CONVERSATION, ON YOUR TERMS');
});
