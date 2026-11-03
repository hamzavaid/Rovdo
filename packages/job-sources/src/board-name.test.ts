import { it, expect } from 'vitest';
import { publicBoardName } from './board-name';
it('identifies a Lever employer only from agreeing live root-page metadata', () => {
  const html =
    '<title>Acme &amp; Co</title><meta content="Acme &amp; Co jobs" property="og:title">';
  expect(publicBoardName(html, 'https://jobs.lever.co/acme')).toBe('Acme & Co');
  expect(publicBoardName(html, 'https://jobs.lever.co/acme/expired')).toBeNull();
  expect(
    publicBoardName(
      '<title>Acme</title><meta property="og:title" content="Other jobs">',
      'https://jobs.lever.co/acme',
    ),
  ).toBeNull();
  expect(
    publicBoardName(
      '<title>Lever</title><meta property="og:title" content="Lever jobs">',
      'https://jobs.lever.co/acme',
    ),
  ).toBeNull();
});
