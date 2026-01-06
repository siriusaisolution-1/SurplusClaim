import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@surplus/rules': path.resolve(__dirname, '../rules/src'),
      '@surplus/shared': path.resolve(__dirname, '../shared/src')
    }
  }
});
