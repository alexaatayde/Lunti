// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // jest.mock() factories must use require(): they run before ES imports are resolved.
    files: ['__tests__/**', 'test-utils/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
