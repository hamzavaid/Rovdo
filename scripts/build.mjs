/**
 * Builds separate renderer, Electron main, isolated preload and profile-worker bundles.
 * Externalize native/runtime dependencies and preserve the worker output when building into the main directory.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { copyFile } from 'node:fs/promises';
import { build } from 'vite';

const desktopRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url));

await build({
  configFile: false,
  root: desktopRoot,
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome142' },
});

// Build process-specific entry points separately so renderer dependency restrictions remain inspectable.
for (const entry of ['main', 'preload']) {
  await build({
    configFile: false,
    root: desktopRoot,
    resolve: { conditions: entry === 'main' ? ['node', 'module'] : ['browser', 'module'] },
    build: {
      outDir: `dist/${entry}`,
      emptyOutDir: true,
      target: 'node22',
      lib: {
        entry: resolve(desktopRoot, `src/${entry}/index.ts`),
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
      rollupOptions: {
        external: ['electron', '@napi-rs/keyring', 'playwright', 'pdf2json', /^node:/],
      },
      minify: false,
    },
  });
}
await build({
  configFile: false,
  root: desktopRoot,
  resolve: { conditions: ['node', 'module'] },
  build: {
    outDir: 'dist/main',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    lib: {
      entry: resolve(desktopRoot, 'src/main/profile-worker.ts'),
      formats: ['cjs'],
      fileName: () => 'profile-worker.cjs',
    },
    rollupOptions: { external: ['pdf2json', /^node:/] },
  },
});

await copyFile(
  resolve(desktopRoot, 'src/main/jobspy-worker.py'),
  resolve(desktopRoot, 'dist/main/jobspy-worker.py'),
);
