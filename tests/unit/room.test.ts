// 방 규칙(순수 로직) 테스트: 네트워크 없이 서버 판정을 검증한다.
import { describe, expect, it } from 'vitest';
import { legalCandidates, Rng } from '../../src/engine';
import {
  addHuman,
  authenticate,
  buildView,
  createRoom,
  expiryTime,
  guardRulesVersion,
  handleCommand,
  nextDue,
  onConnect,
  onDisconnect,
  runDueTasks,
  seatOf,
  TIMING,
  type RoomEnv,
} from '../../src/room/core';
import type { Member, RoomState } from '../../src/room/types';
import type { Command } from '../../src/shared/protocol';

class Clock {
  now = 1_000_000;
  rng = new Rng(12345);
  env = (): RoomEnv => ({ now: this.now, random: () => this.rng.next() });
  tick(ms: number) {
    this.now += ms;
  }
}

let cmdSeq = 0;
function cmd(room: RoomState, clock: Clock, who: Member | string, c: Command, id = 'c' + ++cmdSeq) {
  return handleCommand(room, typeof who === 'string' ? who : who.id, id, c, clock.env());
}

function setup(humans = 2, bots = 0, settings: Partial<RoomState['settings']> = {}) {
  const clock = new Clock();
  const { state: room, host } = createRoom('ABCDEF', '호스트', clock.env(), { settings });
  onConnect(room, host.id, clock.env());
  const people: Member[] = [host];
  for (let i = 1; i < humans; i++) {
    const m = addHuman(room, '친구' + i, clock.env()) as Member;
    onConnect(room, m.id, clock.env());
    cmd(room, clock, m, { a: 'ready', ready: true });
    people.push(m);
  }
  for (let i = 0; i < bots; i++) cmd(room, clock, host, { a: 'addBot', level: i % 2 ? 'easy' : 'medium' });
  return { clock, room, host, people };
}

/** 사람 자리의 합법 배치를 하나 골라 제출 */
function humanPlay(room: RoomState, clock: Clock, m: Member) {
  const g = room.game!;
  if (!g.turn) return { ok: false, changed: false };
  const seat = seatOf(room, m.id);
  const c = legalCandidates(g, seat)[0];
  return cmd(room, clock, m, { a: 'place', turnId: g.turn!.id, placement: c.placement, target: g.turn!.targets[seat] });
}

/** 게임이 끝날 때까지: 사람은 즉시 두고, 봇·마감은 시간을 흘려 처리 */
function playToEnd(room: RoomState, clock: Clock, humans: Member[]) {
  for (let guard = 0; guard < 2000 && room.game!.phase !== 'gameOver'; guard++) {
    const g = room.game!;
    if (g.phase === 'seasonEnd') {
      for (const h of humans) cmd(room, clock, h, { a: 'seasonReady', season: g.season });
      continue;
    }
    for (const h of humans) {
      const seat = seatOf(room, h.id);
      if (seat >= 0 && room.game!.turn && !room.game!.turn.subs[seat]) humanPlay(room, clock, h);
    }
    clock.tick(500);
    runDueTasks(room, clock.env());
  }
}

describe('입장과 자리', () => {
  it('같은 닉네임은 #2 로 구분되고, 닉네임만으로는 자리를 가져갈 수 없다', () => {
    const { room, clock, host } = setup(1);
    const dup = addHuman(room, '호스트', clock.env()) as Member;
    expect(dup.tag).toBe(2);
    expect(authenticate(room, host.id, 'x'.repeat(32))).toBeNull();
    expect(authenticate(room, host.id, host.secret)?.id).toBe(host.id);
  });
  it('봇 포함 최대 8자리, 넘치면 관전자', () => {
    const { room, clock, host } = setup(2, 6);
    expect(room.seats.length).toBe(8);
    expect(cmd(room, clock, host, { a: 'addBot', level: 'easy' }).err).toBe('seats-full');
    const late = addHuman(room, '늦은이', clock.env()) as Member;
    expect(late.role).toBe('spectator');
  });
  it('방장만 설정·시작, 준비 안 된 사람이 있으면 시작 불가', () => {
    const { room, clock, host, people } = setup(2);
    cmd(room, clock, people[1], { a: 'ready', ready: false });
    expect(cmd(room, clock, people[1], { a: 'start' }).err).toBe('not-host');
    expect(cmd(room, clock, host, { a: 'start' }).err).toBe('not-ready');
    cmd(room, clock, people[1], { a: 'ready', ready: true });
    expect(cmd(room, clock, host, { a: 'settings', settings: { turnSeconds: 60 } }).ok).toBe(true);
    expect(cmd(room, clock, host, { a: 'start' }).ok).toBe(true);
    expect(room.game).not.toBeNull();
  });
  it('시작 후 들어온 사람은 관전자이고 자리 순서는 바뀌지 않는다', () => {
    const { room, clock, host } = setup(2, 1);
    cmd(room, clock, host, { a: 'start' });
    const seats = [...room.seats];
    const late = addHuman(room, '관전', clock.env()) as Member;
    expect(late.role).toBe('spectator');
    expect(room.seats).toEqual(seats);
  });
});

describe('서버 판정', () => {
  it('같은 commandId 는 한 번만 실행된다', () => {
    const { room, clock, host } = setup(2);
    cmd(room, clock, host, { a: 'start' });
    const g = room.game!;
    const c = legalCandidates(g, 0)[0];
    const first = cmd(room, clock, host, { a: 'place', turnId: g.turn!.id, placement: c.placement }, 'same-id');
    const again = cmd(room, clock, host, { a: 'place', turnId: g.turn!.id, placement: c.placement }, 'same-id');
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: true, dup: true, changed: false });
  });
  it('지난 턴 제출·다른 사람 지도 대상은 거부', () => {
    const { room, clock, host, people } = setup(2);
    cmd(room, clock, host, { a: 'start' });
    const g = room.game!;
    const turnId = g.turn!.id;
    const c0 = legalCandidates(g, 0)[0];
    expect(cmd(room, clock, host, { a: 'place', turnId, placement: c0.placement, target: 1 }).err).toBe('not-your-target');
    humanPlay(room, clock, host);
    humanPlay(room, clock, people[1]);
    expect(room.game!.turn?.id ?? -1).not.toBe(turnId);
    expect(cmd(room, clock, host, { a: 'place', turnId, placement: c0.placement }).err).toBe('wrong-turn');
  });
  it('마지막 두 제출이 연달아 와도 턴은 한 번만 해결된다', () => {
    const { room, clock, host, people } = setup(2);
    cmd(room, clock, host, { a: 'start' });
    const before = room.game!.turn!.id;
    humanPlay(room, clock, host);
    humanPlay(room, clock, people[1]);
    const g = room.game!;
    const logsForTurn = g.players.map((p) => p.log.filter((l) => l.turn === before).length);
    expect(logsForTurn).toEqual([1, 1]);
    // 다음 턴은 정확히 하나 앞으로(솔로 매복 같은 자동 처리 없음)
    if (g.turn) expect(g.turn.id).toBe(before + 1);
  });
  it('시간 초과: 미제출 자리는 합법 배치로 자동 처리되고, 늦게 온 제출은 거부', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 60 });
    cmd(room, clock, host, { a: 'start' });
    const turnId = room.game!.turn!.id;
    humanPlay(room, clock, host);
    const late = legalCandidates(room.game!, 1)[0];
    clock.tick(60_000);
    runDueTasks(room, clock.env());
    const g = room.game!;
    const auto = g.players[1].log.find((l) => l.turn === turnId)!;
    expect(auto.auto).toBe('timeout');
    expect(g.players[0].log.find((l) => l.turn === turnId)!.auto).toBe('self');
    expect(cmd(room, clock, people[1], { a: 'place', turnId, placement: late.placement }).err).toBe('wrong-turn');
  });
  it('시간 초과와 사람 제출이 거의 동시여도 하나만 반영', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 60 });
    cmd(room, clock, host, { a: 'start' });
    const turnId = room.game!.turn!.id;
    humanPlay(room, clock, host);
    clock.tick(59_999);
    humanPlay(room, clock, people[1]); // 마감 1ms 전 제출 → 턴 해결
    clock.tick(1);
    runDueTasks(room, clock.env()); // 지난 턴의 마감 작업은 아무것도 하지 않는다
    const entries = room.game!.players[1].log.filter((l) => l.turn === turnId);
    expect(entries.length).toBe(1);
    expect(entries[0].auto).toBe('self');
  });
  it('매복 단계에서도 시간 초과가 처리된다', () => {
    const { room, clock, host } = setup(2, 0, { turnSeconds: 60 });
    cmd(room, clock, host, { a: 'start' });
    let guard = 0;
    while (room.game!.phase !== 'ambush' && room.game!.phase !== 'gameOver' && guard++ < 200) {
      if (room.game!.phase === 'seasonEnd') {
        clock.tick(TIMING.seasonPauseMs);
        runDueTasks(room, clock.env());
        continue;
      }
      clock.tick(60_000);
      runDueTasks(room, clock.env());
    }
    expect(room.game!.phase).toBe('ambush');
    const turnId = room.game!.turn!.id;
    clock.tick(60_000);
    runDueTasks(room, clock.env());
    const monsterLogs = room.game!.players.flatMap((p) => p.log.filter((l) => l.turn === turnId));
    expect(monsterLogs.length).toBe(2);
    expect(monsterLogs.every((l) => l.kind === 'ambush' && l.auto === 'timeout')).toBe(true);
  });
});

describe('연결 종료와 대리 진행', () => {
  it('시간 제한 없는 방: 유예 뒤 임시 봇이 대신 두고, 돌아오면 다시 직접 한다', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 0 });
    cmd(room, clock, host, { a: 'start' });
    const friend = people[1];
    onDisconnect(room, friend.id, clock.env());
    humanPlay(room, clock, host);
    const turnId = room.game!.turn!.id;
    clock.tick(TIMING.reconnectGraceMs);
    runDueTasks(room, clock.env());
    expect(room.members.find((m) => m.id === friend.id)!.proxy).toBe(true);
    clock.tick(TIMING.proxyDelayMs);
    runDueTasks(room, clock.env());
    expect(room.game!.players[1].log.find((l) => l.turn === turnId)?.auto).toBe('proxy');
    onConnect(room, friend.id, clock.env());
    expect(room.members.find((m) => m.id === friend.id)!.proxy).toBe(false);
    // 보드와 누적 점수는 그대로
    expect(room.game!.players[1].log.length).toBeGreaterThan(0);
  });
  it('방장이 온라인이지만 응답 없는 참가자를 대리 진행으로 바꿀 수 있다', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 0 });
    cmd(room, clock, host, { a: 'start' });
    const turnId = room.game!.turn!.id;
    humanPlay(room, clock, host);
    expect(cmd(room, clock, host, { a: 'proxy', memberId: people[1].id }).ok).toBe(true);
    clock.tick(TIMING.proxyDelayMs);
    runDueTasks(room, clock.env());
    expect(room.game!.players[1].log.find((l) => l.turn === turnId)?.auto).toBe('proxy');
    // 본인이 직접 두면 조작을 되찾는다
    humanPlay(room, clock, people[1]);
    expect(room.members.find((m) => m.id === people[1].id)!.proxy).toBe(false);
  });
  it('방장이 끊기면 유예 뒤 다른 접속자에게 방장이 넘어간다', () => {
    const { room, clock, host, people } = setup(3);
    onDisconnect(room, host.id, clock.env());
    clock.tick(TIMING.hostGraceMs);
    runDueTasks(room, clock.env());
    expect(room.hostId).toBe(people[1].id);
  });
  it('모두 떠나면 진행을 멈추고(예약 작업 보류), 돌아오면 마감을 늦춰 이어 간다', () => {
    const { room, clock, host, people } = setup(2, 1, { turnSeconds: 60 });
    cmd(room, clock, host, { a: 'start' });
    onDisconnect(room, host.id, clock.env());
    onDisconnect(room, people[1].id, clock.env());
    expect(room.paused).toBe(true);
    const due = nextDue(room);
    expect(due === null || due === room.tasks.expire || due === room.tasks.host).toBe(true);
    clock.tick(10 * 60_000);
    runDueTasks(room, clock.env());
    const turnId = room.game!.turn!.id;
    expect(room.game!.turn!.subs.every((s) => s === null)).toBe(true);
    onConnect(room, host.id, clock.env());
    expect(room.paused).toBe(false);
    expect(room.turnDeadline! - clock.now).toBeGreaterThanOrEqual(TIMING.resumeDeadlineMinMs - 1);
    expect(room.game!.turn!.id).toBe(turnId);
  });
});

describe('게임 전체', () => {
  it('사람 2 + 봇 6 (8자리) 끝까지 진행, 결과와 재경기', () => {
    const { room, clock, host, people } = setup(2, 6, { turnSeconds: 90 });
    expect(cmd(room, clock, host, { a: 'start' }).ok).toBe(true);
    playToEnd(room, clock, people);
    const g = room.game!;
    expect(g.phase).toBe('gameOver');
    expect(g.players.every((p) => p.seasons.length === 4)).toBe(true);
    const view = buildView(room, host.id, clock.env());
    expect(view.game!.standings!.length).toBe(8);
    expect(view.game!.logs!.length).toBe(8);
    expect(room.finishedAt).not.toBeNull();
    expect(cmd(room, clock, people[1], { a: 'rematch' }).err).toBe('not-host');
    expect(cmd(room, clock, host, { a: 'rematch' }).ok).toBe(true);
    expect(room.game!.phase === 'draw' || room.game!.phase === 'ambush').toBe(true);
    expect(room.gameNo).toBe(2);
    expect(room.seats.length).toBe(8);
  });
  it('계절 종료: 모든 접속한 사람이 준비하면 바로 다음 계절, 아니면 대기 시간 후', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 0 });
    cmd(room, clock, host, { a: 'start' });
    for (let guard = 0; guard < 100 && room.game!.phase !== 'seasonEnd'; guard++) {
      for (const h of people) {
        const seat = seatOf(room, h.id);
        if (room.game!.turn && !room.game!.turn.subs[seat]) humanPlay(room, clock, h);
      }
    }
    expect(room.game!.phase).toBe('seasonEnd');
    cmd(room, clock, host, { a: 'seasonReady', season: 0 });
    expect(room.game!.phase).toBe('seasonEnd');
    clock.tick(TIMING.seasonPauseMs);
    runDueTasks(room, clock.env());
    expect(room.game!.season).toBe(1);
  });
});

describe('보기(View)와 비밀', () => {
  it('비밀 토큰·덱·씨앗·다른 사람의 미확정 배치는 보내지 않는다', () => {
    const { room, clock, host, people } = setup(2);
    cmd(room, clock, host, { a: 'start' });
    humanPlay(room, clock, host);
    const view = buildView(room, people[1].id, clock.env());
    const text = JSON.stringify(view);
    for (const m of room.members) if (m.secret) expect(text).not.toContain(m.secret);
    expect(text).not.toContain('"deck"');
    expect(text).not.toContain('"seed"');
    expect(text).not.toContain('"rng"');
    expect(view.game!.turn!.submitted).toEqual([true, false]);
    expect(view.game!.turn!.mine).toBeNull();
    const hostView = buildView(room, host.id, clock.env());
    expect(hostView.game!.turn!.mine).not.toBeNull();
  });
});

describe('규칙 버전', () => {
  it('진행 중인 게임이 옛 규칙 버전이면 조용히 이어 가지 않고 대기실로 되돌린다', () => {
    const { room, clock, host } = setup(2);
    cmd(room, clock, host, { a: 'start' });
    room.game!.rules = 'old-version';
    expect(guardRulesVersion(room, 'new-version', clock.env())).toBe(true);
    expect(room.game).toBeNull();
    expect(room.notice).toContain('업데이트');
    expect(guardRulesVersion(room, 'new-version', clock.env())).toBe(false);
  });
  it('끝난 게임 결과는 버전이 달라도 그대로 둔다', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 90 });
    cmd(room, clock, host, { a: 'start' });
    playToEnd(room, clock, people);
    room.game!.rules = 'old-version';
    expect(guardRulesVersion(room, 'new-version', clock.env())).toBe(false);
    expect(room.game!.phase).toBe('gameOver');
  });
});

describe('보관 기간', () => {
  it('끝난 게임은 종료 24시간 뒤 만료, 진행 중인 게임은 활동이 있으면 지우지 않는다', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 0 });
    cmd(room, clock, host, { a: 'start' });
    // 23시간 동안 가끔 활동
    for (let i = 0; i < 23; i++) {
      clock.tick(60 * 60 * 1000);
      humanPlay(room, clock, host);
      humanPlay(room, clock, people[1]);
      runDueTasks(room, clock.env());
    }
    expect(room.expired).toBe(false);
    clock.tick(TIMING.inactiveTtlMs - 1000);
    runDueTasks(room, clock.env());
    expect(room.expired).toBe(false);
    clock.tick(2000);
    runDueTasks(room, clock.env());
    expect(room.expired).toBe(true);
  });
  it('종료 시각 + 24시간', () => {
    const { room, clock, host, people } = setup(2, 0, { turnSeconds: 90 });
    cmd(room, clock, host, { a: 'start' });
    playToEnd(room, clock, people);
    expect(expiryTime(room)).toBe(room.finishedAt! + TIMING.finishedTtlMs);
  });
});
