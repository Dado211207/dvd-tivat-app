import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // A scrollable region MUST take a tab stop, or a keyboard user cannot
      // scroll it (axe: scrollable-region-focusable). Allowed only where the
      // element is a labelled region, which is the pattern ScrollRegion uses.
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The domain layer must stay deterministic; ctx supplies time and ids.
      'no-restricted-globals': ['error', { name: 'event', message: 'Use the handler parameter.' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The service worker runs in its own global scope, not the window's.
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },
  {
    // Build and verification scripts run in Node, not a browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // The domain layer is pure: no browser, no clock, no randomness.
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Domain code must take time from ctx.now().' },
        { object: 'Math', property: 'random', message: 'Domain code must take ids from ctx.id().' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'The domain layer must not touch the browser.' },
        { name: 'document', message: 'The domain layer must not touch the browser.' },
        { name: 'localStorage', message: 'The domain layer must not touch the browser.' },
      ],
    },
  },
);
