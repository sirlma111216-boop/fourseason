import { defineConfig } from 'vitest/config';

// 브라우저 화면 시험(설치된 Chrome + wrangler dev). npm run test:e2e
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 180_000,
  },
});
