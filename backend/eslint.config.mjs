// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      '@typescript-eslint.io/rules/no-unsafe-call': 'warn',
      'typescript-eslint.io/rules/no-unsafe-member-access': 'warn',
      'typescript-eslint.io/rules/no-unsafe-return': 'warn',
      'typescript-eslint.io/rules/no-unsafe-assignment': 'warn',
      'typescript-eslint.io/rules/no-unsafe-enum-comparison': 'warn',
      'typescript-eslint.io/rules/no-unsafe-type-assertion': 'warn',
      'typescript-eslint.io/rules/no-unsafe-type-parameters': 'warn',
      // 'typescript-eslint.io/rules/no-unsafe-type-parameters': 'off',
      // 'typescript-eslint.io/rules/no-unsafe-assignment': 'off',
    },
  },
);
