import { expect, it } from 'vitest';
import { renderSandboxProfile } from '../../../scripts/linux-sandbox';

const root = '/home/runner/.cache/ms-playwright';
it('grants user namespaces only to the installed full and headless Chromium executables', () => {
  const full = `${root}/chromium-1248/chrome-linux64/chrome`;
  const headless = `${root}/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`;
  const policy = renderSandboxProfile(root, [full, headless, full]);
  expect(policy).toContain(`profile rovdo-playwright-0 "${full}" flags=(unconfined)`);
  expect(policy).toContain(`profile rovdo-playwright-1 "${headless}" flags=(unconfined)`);
  expect(policy.match(/userns,/g)).toHaveLength(2);
  expect(policy).not.toContain('*');
  expect(policy).not.toContain('sysctl');
});
it('rejects empty inventories, out-of-cache paths and AppArmor syntax injection', () => {
  for (const paths of [[], ['/usr/bin/chrome'], [`${root}/../elsewhere/chrome`], [`${root}/chromium/*/chrome`], [`${root}/chromium/"chrome`], [`${root}/chromium/chrome\nuserns,`], [`${root}/chromium/node`]]) {
    expect(() => renderSandboxProfile(root, paths)).toThrow();
  }
});
