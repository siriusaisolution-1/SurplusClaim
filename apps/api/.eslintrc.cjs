const path = require('path');

module.exports = {
  extends: [path.join(__dirname, '..', '..', '.eslintrc.cjs')],
  parserOptions: {
    project: [path.join(__dirname, 'tsconfig.json')],
    tsconfigRootDir: __dirname
  },
  overrides: [
    {
      files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        'import/order': 'off',
        'import/no-unresolved': 'off'
      }
    }
  ]
};
