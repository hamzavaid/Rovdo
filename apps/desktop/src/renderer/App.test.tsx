import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('foundation shell', () => {
  it('states the current capability without advertising unfinished features', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Rovdo');
    expect(html).toContain('Browser + Jobs');
    expect(html).toContain('Loading models...');
    expect(html).toContain('Your profile stays local');
    expect(html).toContain('Models &amp; Privacy');
    expect(html).not.toContain('type="password"');
  });
});
