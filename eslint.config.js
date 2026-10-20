/**
 * Repository lint rules and renderer dependency/security boundaries.
 * Privileged imports and Node globals are prohibited in renderer modules.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'docs/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'error' },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            'electron',
            '@rovdo/agent-core',
            '@rovdo/providers',
            '@rovdo/storage',
            '@rovdo/shared/network',
            '@rovdo/browser-worker',
            '@rovdo/job-discovery',
            '@rovdo/job-sources',
            '@napi-rs/*',
            'openai',
            '@anthropic-ai/*',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'process', 'require', 'Buffer', '__dirname', '__filename'],
    },
  },
);
