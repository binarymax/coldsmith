import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/',
      'examples/*/build/',
      'examples/*/node_modules/',
      // Site content is user data, not project source.
      'examples/*/contents/',
      'test/fixtures/*/contents/',
      // Generated snapshots, not source.
      'test/golden/',
    ],
  },

  js.configs.recommended,

  // The library and CLI: ESM, node.
  {
    files: ['src/**/*.js', 'bin/coldsmith', 'test/**/*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Empty catch blocks are used deliberately, with a comment saying why.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Site-side code: plugins and views in example and fixture sites are
  // CommonJS, because that is what published wintersmith plugins are.
  {
    files: ['examples/**/*.js', 'test/fixtures/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  prettier,
]
