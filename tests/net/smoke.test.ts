// 배포된 주소에 대한 연기 시험(선택): SMOKE_BASE=https://… npx vitest run --config vitest.net.config.ts tests/net/smoke.test.ts
// 실제 운영 방을 하나 만들어 두 사람이 끝까지 둔다(방은 보관 기간 뒤 자동 삭제).
import { describe, expect, it } from 'vitest';
import { TestClient, playToEnd } from './client';

const BASE = process.env.SMOKE_BASE ?? '';

describe.skipIf(!BASE)('배포 주소 연기 시험', () => {
  it('정적 화면·API·SPA 라우팅', async () => {
    const health = await (await fetch(BASE + '/api/health')).json();
    expect(health.ok).toBe(true);
    const spa = await fetch(BASE + '/r/ABCDEF');
    expect(spa.headers.get('content-type')).toContain('text/html');
    const api = await fetch(BASE + '/api/nothing');
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).toContain('application/json');
    const img = await fetch(BASE + '/assets/backgrounds/title.webp');
    expect(img.headers.get('content-type')).toContain('image/webp');
  });

  it('두 사람이 운영 서버에서 끝까지 두고 결과를 받는다', async () => {
    const r = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: '연기시험A' }) });
    const created = (await r.json()) as { code: string; id: string; secret: string };
    const a = new TestClient(BASE, created.code, '연기시험A');
    a.id = created.id;
    a.secret = created.secret;
    await a.connect();
    const b = new TestClient(BASE, created.code, '연기시험B');
    await b.connect(null);
    await b.send({ a: 'ready', ready: true });
    await a.send({ a: 'settings', settings: { turnSeconds: 0 } });
    expect((await a.send({ a: 'start' })).ok).toBe(true);
    await b.waitFor(() => !!b.room!.game?.turn, 15000, 'start');
    const t0 = Date.now();
    await playToEnd([a, b], { concurrent: true });
    const g = a.room!.game!;
    expect(g.phase).toBe('gameOver');
    expect(g.standings!.length).toBe(2);
    console.log(`운영 서버 한 판: ${((Date.now() - t0) / 1000).toFixed(1)}초, 점수 ${g.standings!.map((s) => s.total).join(' / ')}`);
    a.close();
    b.close();
  }, 300_000);

  it('사람 1 + 봇 7(8자리)이 운영 서버 실행 한도 안에서 끝까지 진행', async () => {
    const r = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: '연기시험봇' }) });
    const created = (await r.json()) as { code: string; id: string; secret: string };
    const a = new TestClient(BASE, created.code, '연기시험봇');
    a.id = created.id;
    a.secret = created.secret;
    await a.connect();
    for (let i = 0; i < 7; i++) expect((await a.send({ a: 'addBot', level: i % 2 ? 'easy' : 'medium' })).ok).toBe(true);
    await a.send({ a: 'settings', settings: { turnSeconds: 90 } });
    expect((await a.send({ a: 'start' })).ok).toBe(true);
    await a.waitFor(() => !!a.room!.game?.turn, 15000, 'start');
    const t0 = Date.now();
    await playToEnd([a]);
    const g = a.room!.game!;
    expect(g.phase).toBe('gameOver');
    expect(g.standings!.length).toBe(8);
    console.log(`운영 서버 8자리(봇 7) 한 판: ${((Date.now() - t0) / 1000).toFixed(1)}초`);
    a.close();
  }, 600_000);
});
