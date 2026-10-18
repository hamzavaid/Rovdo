import { readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const browserNames = new Set(['chrome', 'chrome-headless-shell']);

/** Exact executable attachments only: no cache-wide wildcard or sysctl changes. */
export function renderSandboxProfile(root: string, executables: string[]): string {
  const validPath = (path: string) => /^\/[A-Za-z0-9_./+-]+$/.test(path) && posix.normalize(path) === path;
  if (!validPath(root) || !executables.length) throw new Error('INVALID_BROWSER_INVENTORY');
  const unique = [...new Set(executables)].sort();
  for (const executable of unique) {
    if (!validPath(executable) || !executable.startsWith(`${root}/`) || !browserNames.has(posix.basename(executable))) throw new Error('INVALID_BROWSER_PATH');
  }
  return 'abi <abi/4.0>,\ninclude <tunables/global>\n\n' + unique.map((executable, index) =>
    `profile rovdo-playwright-${index} "${executable}" flags=(unconfined) {\n  userns,\n}\n`,
  ).join('\n');
}

export async function discoverBrowserExecutables(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 4) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (browserNames.has(entry.name) && (entry.isFile() || entry.isSymbolicLink())) found.push(await realpath(path));
    }
  }
  await walk(root, 0); return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'linux') throw new Error('LINUX_ONLY');
  const root = await realpath(process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright'));
  process.stdout.write(renderSandboxProfile(root, await discoverBrowserExecutables(root)));
}
