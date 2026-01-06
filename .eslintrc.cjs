module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.base.json', './packages/*/tsconfig.json', './apps/*/tsconfig.json'],
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  env: {
    node: true,
    es2020: true
  },
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.base.json', './packages/*/tsconfig.json', './apps/*/tsconfig.json']
      },
      node: true
    }
  },
  rules: {
    'import/no-unresolved': 'off',
    'import/namespace': 'off',
    'import/no-duplicates': 'off',
    'import/default': 'off',
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    'import/order': [
      'error',
      {
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true }
      }
    ]
  },
  overrides: [
    {
      files: ['packages/audit/src/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off'
      }
    },
    {
      files: ['packages/rules/src/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off',
        'import/default': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off',
        'import/export': 'off'
      }
    },
    {
      files: ['packages/shared/src/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off',
        'import/export': 'off',
        'import/default': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off'
      }
    },
    {
      files: ['apps/web/src/**/*.{ts,tsx}'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off',
        'import/export': 'off',
        'import/default': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off'
      }
    },
    {
      files: ['packages/connectors/src/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off',
        'import/export': 'off',
        'import/default': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off'
      }
    },
    {
      files: ['apps/api/src/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off',
        'import/export': 'off',
        'import/default': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off'
      }
    },
    {
      files: ['apps/worker/src/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
        'import/order': 'off',
        'import/export': 'off',
        'import/default': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off'
      }
    }
  ],
  ignorePatterns: ['node_modules', 'dist']
};
