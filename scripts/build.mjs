import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';

const desktopRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url));

await build({
  configFile: false,
  root: desktopRoot,
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome142' },
});

for (const entry of ['main', 'preload']) {
  await build({
    configFile: false,
    root: desktopRoot,
    build: {
      outDir: `dist/${entry}`, emptyOutDir: true, target: 'node22',
      lib: { entry: resolve(desktopRoot, `src/${entry}/index.ts`), formats: ['cjs'], fileName: () => 'index.cjs' },
      rollupOptions: { external: ['electron', /^node:/] },
      minify: false,
    },
  });
}
