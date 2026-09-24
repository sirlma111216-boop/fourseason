import { defineConfig } from 'vitest/config';

// 네트워크 시험(실제 wrangler dev 를 띄운다). npm run test:net
export default defineConfig({
  test: {
    include: ['tests/net/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
