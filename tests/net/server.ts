// 시험용 로컬 Worker(wrangler dev) 띄우기/끄기/다시 띄우기.
// 같은 --persist-to 폴더를 쓰면 다시 띄워도 Durable Object 저장소가 남는다(인스턴스 재생성 시험).
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

export interface TestServer {
  port: number;
  base: string;
  logFile: string;
  resetState(): void;
  start(vars?: Record<string, string>): Promise<void>;
  stop(): Promise<void>;
}

export function makeServer(port: number, name: string): TestServer {
  const persistRel = `.wrangler/${name}-state`;
  const persist = resolve(ROOT, persistRel);
  const base = `http://127.0.0.1:${port}`;
  const logFile = resolve(tmpdir(), `sgjd-${name}-wrangler.log`);
  let proc: ChildProcess | null = null;

  return {
    port,
    base,
    logFile,
    resetState() {
      rmSync(persist, { recursive: true, force: true });
      rmSync(logFile, { force: true });
    },
    async start(vars = {}) {
      // 경로에 공백이 있어도 되도록 상대 경로를 넘긴다(cwd = 프로젝트 루트)
      const args = ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistRel, '--show-interactive-dev-session=false'];
      for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
      proc = spawn('npx', args, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const sink = (d: Buffer) => appendFileSync(logFile, String(d));
      proc.stdout!.on('data', sink);
      proc.stderr!.on('data', sink);
      let exited = false;
      proc.on('exit', () => (exited = true));
      const t0 = Date.now();
      while (Date.now() - t0 < 90_000 && !exited) {
        try {
          const r = await fetch(base + '/api/health');
          if (r.ok) return;
        } catch {
          /* 아직 */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`wrangler dev did not start (log: ${logFile})`);
    },
    async stop() {
      if (!proc) return;
      const pid = proc.pid;
      proc = null;
      try {
        if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        else process.kill(-pid!, 'SIGKILL');
      } catch {
        /* 이미 종료 */
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 20_000) {
        try {
          await fetch(base + '/api/health');
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          return;
        }
      }
    },
  };
}

// 네트워크 시험 기본 서버
const net = makeServer(8788, 'net-test');
export const PORT = net.port;
export const BASE = net.base;
export const LOG_FILE = net.logFile;
export const resetState = () => net.resetState();
export const startServer = (vars: Record<string, string>) => net.start(vars);
export const stopServer = () => net.stop();
