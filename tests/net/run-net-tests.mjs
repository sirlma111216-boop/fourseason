// 네트워크 시험 실행기: 화면을 빌드한 뒤(정적 자산이 필요) vitest 네트워크 시험을 돌린다.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('dist/index.html')) execSync('npx vite build', { stdio: 'inherit' });
execSync('npx vitest run --config vitest.net.config.ts', { stdio: 'inherit' });
