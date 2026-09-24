// 실제 로컬 Worker + Durable Object 에 WebSocket 으로 붙는 네트워크 시험.
// 실행: npm run test:net  (dist 가 없으면 먼저 빌드한다)
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseBotPlacement } from '../../src/engine/bot';
import { engineState } from '../../src/room/view-state';
import { TestClient, playToEnd, rid } from './client';
import { BASE, PORT, resetState, startServer, stopServer } from './server';

const VARS = { TIME_SCALE: '0.01', ROOM_TTL_MS: '40000' };

async function createRoom(nick: string): Promise<{ code: string; id: string; secret: string }> {
  const r = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick }) });
  expect(r.status).toBe(200);
  return (await r.json()) as { code: string; id: string; secret: string };
}

async function host(nick: string) {
  const c = await createRoom(nick);
  const h = new TestClient(BASE, c.code, nick);
  h.id = c.id;
  h.secret = c.secret;
  await h.connect();
  return h;
}

async function guest(code: string, nick: string) {
  const g = new TestClient(BASE, code, nick);
  await g.connect(null);
  return g;
}

const expiryRoom: { code: string } = { code: '' };
let expiryCreatedAt = 0;

beforeAll(async () => {
  resetState();
  await startServer(VARS);
  // 만료 시험용 방: 처음에 만들고 마지막에 확인한다
  const h = await host('만료시험');
  expiryRoom.code = h.code;
  expiryCreatedAt = Date.now();
  h.close();
}, 120_000);

afterAll(async () => {
  await stopServer();
});

describe('라우팅과 입력 검증', () => {
  it('API 는 JSON, SPA 경로는 HTML, WebSocket 경로에 index.html 을 주지 않는다', async () => {
    const api = await fetch(BASE + '/api/nothing');
    expect(api.headers.get('content-type')).toContain('application/json');
    const spa = await fetch(BASE + '/r/ABCDEF');
    expect(spa.headers.get('content-type')).toContain('text/html');
    const ws = await fetch(BASE + '/ws/ABCDEF');
    expect(ws.status).toBe(426);
    expect(ws.headers.get('content-type')).toContain('application/json');
  });

  it('다른 사이트 Origin 의 WebSocket 업그레이드는 거부', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: PORT,
        path: '/ws/ABCDEF',
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: 'https://evil.example' },
      });
      req.on('response', (res) => resolve(res.statusCode ?? 0));
      req.on('upgrade', () => resolve(101));
      req.end();
    });
    expect(status).toBe(403);
  });

  it('형식이 틀린 메시지·너무 큰 메시지·너무 잦은 메시지는 거절', async () => {
    const h = await host('검증');
    h.sendRaw('{not json');
    h.sendRaw(JSON.stringify({ t: 'cmd', id: 'x', cmd: { a: 'place', turnId: 1, placement: { kind: 'shape', shape: 9 } } }));
    h.sendRaw('x'.repeat(5000));
    await h.waitFor(() => h.errors.filter((e) => e.code === 'bad-message').length >= 3, 5000, 'bad-message x3');
    // (시험 모드는 허용량이 10배라 넉넉히 보낸다)
    for (let i = 0; i < 600; i++) h.sendRaw(JSON.stringify({ t: 'sync' }));
    await h.waitFor(() => h.errors.some((e) => e.code === 'rate-limit'), 5000, 'rate-limit');
    h.close();
  });

  it('없는 방 코드는 안내 오류', async () => {
    const c = new TestClient(BASE, 'ZZZZZZ', '누구');
    await c.connect(null, { expectError: true });
    expect(c.errors[0]?.code).toBe('not-found');
  });
});

describe('두 사람이 같은 방에서 끝까지', () => {
  it('서로 다른 지도를 완성하고, 중복·지난 턴·다른 지도 명령은 거부, 새로고침 복구', async () => {
    const a = await host('가람');
    const b = await guest(a.code, '가람'); // 같은 닉네임 → #2
    expect(b.room!.members.find((m) => m.id === b.id)!.tag).toBe(2);
    // 닉네임·참가자 id 만으로 자리를 가져갈 수 없다: 틀린 토큰이면 새 참가자로 들어올 뿐
    const thief = new TestClient(BASE, a.code, '가람');
    await thief.connect({ id: a.id, secret: 'x'.repeat(32) });
    expect(thief.id).not.toBe(a.id);
    expect(thief.room!.hostId).toBe(a.id);
    expect((await thief.send({ a: 'leave' })).ok).toBe(true);
    thief.close();
    // 닉네임 없이 틀린 토큰이면 복귀 거부 안내
    const nobody = new TestClient(BASE, a.code, '');
    await nobody.connect({ id: a.id, secret: 'y'.repeat(32) }, { expectError: true });
    expect(nobody.errors[0]?.code).toBe('bad-token');
    nobody.close();

    expect((await b.send({ a: 'ready', ready: true })).ok).toBe(true);
    expect((await a.send({ a: 'settings', settings: { turnSeconds: 0 } })).ok).toBe(true);
    expect((await a.send({ a: 'start' })).ok).toBe(true);
    await b.waitFor(() => !!b.room!.game?.turn, 10000, 'game start');

    // 비밀 토큰은 다른 사람에게 가지 않는다
    expect(b.messages.join('')).not.toContain(a.secret);

    // 첫 턴: 같은 commandId 두 번 → 한 번만
    const g = a.room!.game!;
    const t1 = g.turn!.id;
    const choice = chooseBotPlacement(engineState(g), a.seat, 'easy', 7);
    const cmd = { a: 'place', turnId: t1, placement: choice.placement, target: g.turn!.targets[a.seat] } as const;
    const id = rid();
    const first = await a.send(cmd, id);
    const second = await a.send(cmd, id);
    expect(first.ok).toBe(true);
    expect(second.dup).toBe(true);
    // 다른 사람 지도를 대상으로 한 제출은 거부
    const wrong = await b.send({ a: 'place', turnId: t1, placement: { kind: 'pass' }, target: 0 });
    expect(wrong.ok).toBe(false);
    await b.playTurn();
    await a.waitFor(() => (a.room!.game!.turn?.id ?? 0) !== t1, 10000, 'turn advance');
    // 지난 턴 번호 제출은 거부
    const stale = await a.send({ a: 'place', turnId: t1, placement: { kind: 'pass' } });
    expect(stale.ok).toBe(false);
    expect(stale.err).toContain('지나간 턴');

    // 몇 턴 진행 후 B 새로고침(연결 끊고 토큰으로 복귀)
    for (let i = 0; i < 3; i++) {
      const rev = a.room!.revision;
      await Promise.all([a.playTurn(), b.playTurn()]);
      await a.waitFor(() => a.room!.revision > rev, 10000, 'loop progress');
      if (a.room!.game!.phase === 'seasonEnd') break;
    }
    const before = b.room!.game!.players.map((p) => p.board);
    const seatBefore = b.seat;
    b.close();
    await b.waitFor(() => b.closedCode !== null, 5000, 'b closed');
    await b.connect(); // 저장된 id·secret 으로 복귀
    expect(b.seat).toBe(seatBefore);
    expect(b.room!.game!.players.map((p) => p.board)).toEqual(before);

    await playToEnd([a, b], { concurrent: true });
    const end = a.room!.game!;
    expect(end.phase).toBe('gameOver');
    expect(end.players[0].board).not.toEqual(end.players[1].board);
    // 각 턴은 각 지도에 정확히 한 번만 반영(마지막 두 제출 경쟁에도 중복 없음)
    for (const log of end.logs!) {
      const ids = log.map((l) => l.turn);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const st = await (await fetch(BASE + '/api/rooms/' + a.code)).json();
    expect(st.status).toBe('finished');

    // 재경기: 같은 참가자
    expect((await b.send({ a: 'rematch' })).ok).toBe(false); // 방장만
    expect((await a.send({ a: 'rematch' })).ok).toBe(true);
    await b.waitFor(() => b.room!.game!.no === 2 && !!b.room!.game!.turn, 10000, 'rematch');
    expect(b.room!.seats).toEqual(a.room!.seats);
    a.close();
    b.close();
  }, 240_000);
});

describe('Durable Object 재생성 뒤 복원', () => {
  it('서버(인스턴스)를 껐다 켜도 방·게임 상태가 저장소에서 복원되고 이어서 끝낼 수 있다', async () => {
    const a = await host('복원A');
    const b = await guest(a.code, '복원B');
    await b.send({ a: 'ready', ready: true });
    await a.send({ a: 'settings', settings: { turnSeconds: 0 } });
    await a.send({ a: 'start' });
    await b.waitFor(() => !!b.room!.game?.turn, 10000);
    // 네 턴쯤 진행하고, 그리기(또는 매복) 턴 한가운데에서 멈춘다(시간 제한 없는 방이라 저절로 넘어가지 않는다)
    for (let i = 0; i < 12; i++) {
      const g = a.room!.game!;
      if (i >= 4 && g.turn) break;
      const rev = a.room!.revision;
      if (g.phase === 'seasonEnd') await Promise.all([a.seasonReady(), b.seasonReady()]);
      else await Promise.all([a.playTurn(), b.playTurn()]);
      await a.waitFor(() => a.room!.revision > rev, 10000, 'restore progress');
      await b.waitFor(() => b.room!.revision >= a.room!.revision, 10000, 'b sync');
    }
    // 한 사람은 이번 턴을 이미 확정해 둔 상태로 끈다(확정도 저장소에 있어야 한다)
    await a.playTurn();
    await a.waitFor(() => !!a.room!.game!.turn?.submitted[a.seat], 10000, 'a submitted');
    const snapshot = JSON.stringify(a.room!.game!.players.map((p) => p.board));
    const turnId = a.room!.game!.turn?.id;
    const phase = a.room!.game!.phase;
    await stopServer();
    await startServer(VARS);
    await a.connect();
    await b.connect();
    expect(JSON.stringify(a.room!.game!.players.map((p) => p.board))).toBe(snapshot);
    expect(a.room!.game!.turn?.id).toBe(turnId);
    expect(a.room!.game!.phase).toBe(phase);
    expect(a.room!.game!.turn!.submitted[a.seat]).toBe(true);
    expect(a.room!.game!.turn!.mine).not.toBeNull();
    await playToEnd([a, b], { concurrent: true });
    expect(a.room!.game!.phase).toBe('gameOver');
    a.close();
    b.close();
  }, 240_000);
});

describe('방장 이탈', () => {
  it('방장이 끊기고 유예가 지나면 접속 중인 다른 사람에게 방장이 넘어간다', async () => {
    const a = await host('방장');
    const b = await guest(a.code, '친구');
    a.close();
    await b.waitFor(() => b.room!.hostId === b.id, 10000, 'host transfer');
    expect(b.room!.you!.isHost).toBe(true);
    b.close();
  }, 60_000);
});

describe('시간 초과', () => {
  it('일반 턴과 매복 모두 마감 때 서버가 합법 배치를 대신하고 게임이 멈추지 않는다', async () => {
    const a = await host('느림A');
    const b = await guest(a.code, '느림B');
    const c = await guest(a.code, '느림C');
    await b.send({ a: 'ready', ready: true });
    await c.send({ a: 'ready', ready: true });
    await a.send({ a: 'settings', settings: { turnSeconds: 60 } }); // 시험 배율 0.01 → 0.6초
    await a.send({ a: 'start' });
    // 아무도 두지 않는다 → 끝까지 시간 초과로 진행
    await a.waitFor(() => a.room!.game?.phase === 'gameOver', 120_000, 'game over by timeouts');
    const logs = a.room!.game!.logs!.flat();
    expect(logs.some((l) => (l.kind === 'draw' || l.kind === 'fallback') && l.auto === 'timeout')).toBe(true);
    expect(logs.some((l) => l.kind === 'ambush' && l.auto === 'timeout')).toBe(true);
    a.close();
    b.close();
    c.close();
  }, 180_000);
});

describe('봇 포함 8자리', () => {
  it('사람 1 + 봇 7 이 끝까지 진행하고 재경기', async () => {
    const a = await host('혼자인간');
    for (let i = 0; i < 7; i++) expect((await a.send({ a: 'addBot', level: i % 2 ? 'easy' : 'medium' })).ok).toBe(true);
    expect((await a.send({ a: 'addBot', level: 'easy' })).ok).toBe(false); // 9번째는 불가
    await a.send({ a: 'settings', settings: { turnSeconds: 90 } });
    await a.send({ a: 'start' });
    await a.waitFor(() => !!a.room!.game?.turn, 10000);
    await playToEnd([a]);
    const g = a.room!.game!;
    expect(g.standings!.length).toBe(8);
    expect(a.room!.members.filter((m) => m.kind === 'bot').length).toBe(7);
    expect((await a.send({ a: 'rematch' })).ok).toBe(true);
    await a.waitFor(() => a.room!.game!.no === 2, 10000);
    a.close();
  }, 240_000);
});

describe('보관 기간', () => {
  it('비활성 방은 만료되고, 만료된 링크는 안내한다', async () => {
    const wait = Math.max(0, expiryCreatedAt + 40_000 + 3_000 - Date.now());
    await new Promise((r) => setTimeout(r, wait));
    const st = await (await fetch(BASE + '/api/rooms/' + expiryRoom.code)).json();
    expect(st.status).toBe('expired');
    const c = new TestClient(BASE, expiryRoom.code, '늦은사람');
    await c.connect(null, { expectError: true });
    expect(c.errors[0]?.code).toBe('expired');
  }, 120_000);
});

