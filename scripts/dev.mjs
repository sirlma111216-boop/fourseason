// 로컬 개발: 방 서버(wrangler dev, 8787)와 화면(Vite, 5173)을 함께 띄운다.
// 브라우저에서 http://localhost:5173 을 연다. /api 와 /ws 는 Vite 가 8787 로 넘긴다.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// wrangler 는 정적 자산 폴더(dist)가 있어야 뜬다. 처음이면 빈 폴더를 만들어 둔다.
if (!existsSync('dist')) {
  mkdirSync('dist');
  writeFileSync('dist/index.html', '<!doctype html><p>npm run build 후 다시 시도하거나 http://localhost:5173 을 여세요.</p>');
}

const procs = [
  spawn('npx', ['wrangler', 'dev', '--port', '8787'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite', '--port', '5173'], { stdio: 'inherit', shell: true }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
