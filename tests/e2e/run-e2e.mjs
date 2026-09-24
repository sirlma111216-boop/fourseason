// 브라우저 화면 시험 실행기: 최신 화면을 빌드한 뒤 설치된 Chrome 으로 시험한다.
// 다른 브라우저를 쓰려면 E2E_CHANNEL=msedge npm run test:e2e
import { execSync } from 'node:child_process';

execSync('npx vite build', { stdio: 'inherit' });
execSync('npx vitest run --config vitest.e2e.config.ts', { stdio: 'inherit' });
