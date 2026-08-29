// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared base config for the whole workspace. `apps/web` extends this with
 * Next.js-specific rules; every other workspace uses it as-is (ESLint's flat
 * config resolves upward from the linted file to the nearest config file).
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/database/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // NOTE: `consistent-type-imports` is deliberately NOT enabled here.
      // NestJS resolves constructor-injected providers from TypeScript's
      // emitted `design:paramtypes` metadata (emitDecoratorMetadata), which
      // requires the injected class to be a real (value) import — an
      // `import type` erases it and silently breaks DI at runtime.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain CommonJS config files (next.config.js, jest.config.js, ...) run
    // directly under Node, outside the TypeScript project.
    files: ['**/*.config.js', '**/jest.setup.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
