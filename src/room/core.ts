// 방 규칙(순수 로직). Durable Object 와 브라우저(혼자 하기)가 같이 쓴다.
//
// - 저장·소켓·알람은 여기서 다루지 않는다. 바깥(래퍼)이 넣어 주는 now·random 만 쓴다.
// - 상태를 바꾼 함수는 true 를 돌려주거나 outcome.changed 를 켠다. 래퍼는 그때
//   ① 저장소에 저장 → ② 응답(ack) → ③ 모두에게 새 상태를 보낸다.
// - 모든 처리는 동기 함수다. 한 명령을 처리하는 도중에 다른 명령이 끼어들 수 없으므로
//   마지막 두 제출이 동시에 와도 턴 해결·다음 카드 공개가 두 번 일어나지 않는다.

import { chooseBotPlacement, type BotLevel } from '../engine/bot';
import {
  SEASON_THRESHOLDS,
  allSubmitted,
  columnTime,
  createGame,
  resolveTurn,
  standings,
  startNextSeason,
  submitPlacement,
  threshold,
  totalMonsters,
  totalScore,
} from '../engine/game';
import { PLACE_ERROR_TEXT, type PlaceError } from '../engine/board';
import { mixSeed, Rng } from '../engine/rng';
import type { Placement, SubmitBy } from '../engine/types';
import { DEFAULT_SETTINGS, cleanNick, type Command, type RoomSettings } from '../shared/protocol';
import type { GameView, Member, MemberView, RoomState, RoomView } from './types';

export const TIMING = {
  reconnectGraceMs: 45_000,
  hostGraceMs: 30_000,
  seasonPauseMs: 45_000,
  botDelayMinMs: 900,
  botDelayMaxMs: 2600,
  proxyDelayMs: 1200,
  resumeDeadlineMinMs: 20_000,
  finishedTtlMs: 24 * 60 * 60 * 1000,
  inactiveTtlMs: 24 * 60 * 60 * 1000,
  emoteGapMs: 1200,
};
export const LIMITS = { maxSeats: 8, maxMembers: 24, recentCommands: 40 };

export interface RoomEnv {
  now: number;
  random: () => number;
  /** 시험용: 게임 타이머(마감·유예·봇 지연)를 이 배율로 줄인다. 운영에서는 1. */
  timeScale?: number;
  /** 시험용: 보관 기간(ms)을 바꾼다. 운영에서는 24시간. */
  ttlMs?: number;
}

/** 게임 타이머 길이(배율 적용) */
function dur(env: RoomEnv, base: number): number {
  return Math.max(1, Math.round(base * (env.timeScale ?? 1)));
}

export const ERROR_TEXT: Record<string, string> = {
  ...PLACE_ERROR_TEXT,
  'not-host': '방장만 할 수 있습니다',
  'not-lobby': '대기실에서만 할 수 있습니다',
  'not-playing': '게임 중이 아닙니다',
  'not-player': '참가자만 할 수 있습니다',
  'seats-full': '자리가 가득 찼습니다(최대 8자리, 봇 포함)',
  'not-ready': '아직 준비하지 않은 참가자가 있습니다',
  'no-seats': '참가자가 없습니다',
  'no-member': '대상을 찾을 수 없습니다',
  'not-bot': '봇이 아닙니다',
  'not-human': '사람 참가자가 아닙니다',
  'self': '자기 자신에게는 할 수 없습니다',
  'not-over': '게임이 끝난 뒤에 할 수 있습니다',
  'bad-season': '지금 계절이 아닙니다',
  'emote-fast': '감정 표현을 너무 빨리 보냈습니다',
  'room-full': '방 인원이 가득 찼습니다',
  'in-game': '게임 중에는 나갈 수 없습니다(연결을 끊으면 잠시 뒤 임시 봇이 대신합니다)',
};

export function errorText(code: string | undefined): string {
  return (code && ERROR_TEXT[code]) || '처리하지 못했습니다';
}

const BOT_NAMES = ['다람', '솔바람', '여울', '노을', '새벽', '미르', '누리', '하람', '가온', '온새'];

function randomString(random: () => number, len: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return s;
}

export function newMemberId(random: () => number): string {
  return 'm' + randomString(random, 11);
}
export function newSecret(random: () => number): string {
  return randomString(random, 32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
}

function member(state: RoomState, id: string): Member | undefined {
  return state.members.find((m) => m.id === id);
}

export function seatOf(state: RoomState, id: string): number {
  return state.seats.indexOf(id);
}

export function statusOf(state: RoomState): RoomView['status'] {
  if (!state.game) return 'lobby';
  return state.game.phase === 'gameOver' ? 'finished' : 'playing';
}

/** 같은 닉네임이 이미 있으면 #2, #3 … 을 붙인다(닉네임은 표시 이름일 뿐 인증 수단이 아니다). */
function assignTag(state: RoomState, nick: string, selfId: string | null): number {
  const used = new Set(state.members.filter((m) => m.id !== selfId && m.nick === nick).map((m) => m.tag));
  if (!used.size) return 0;
  let tag = 2;
  while (used.has(tag)) tag++;
  return tag;
}

export function displayName(m: Pick<Member, 'nick' | 'tag'>): string {
  return m.tag ? `${m.nick} #${m.tag}` : m.nick;
}

/** 사람의 활동(명령·접속·끊김)만 활동으로 센다. 봇·타이머 진행은 만료를 늦추지 않는다. */
function touch(state: RoomState, env: RoomEnv): void {
  state.lastActivityAt = env.now;
}

export function createRoom(
  code: string,
  hostNick: string,
  env: RoomEnv,
  opts: { local?: boolean; settings?: Partial<RoomSettings> } = {},
): { state: RoomState; host: Member } {
  const nick = cleanNick(hostNick) || '지도사';
  const host: Member = {
    id: newMemberId(env.random),
    secret: newSecret(env.random),
    nick,
    tag: 0,
    kind: 'human',
    role: 'player',
    ready: true,
    connected: false,
    joinedAt: env.now,
    lastSeenAt: env.now,
    disconnectedAt: env.now,
    proxy: false,
    proxyReason: null,
    lastEmoteAt: 0,
  };
  const state: RoomState = {
    v: 1,
    code,
    local: !!opts.local,
    createdAt: env.now,
    lastActivityAt: env.now,
    finishedAt: null,
    hostId: host.id,
    settings: { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) },
    members: [host],
    seats: [host.id],
    game: null,
    gameNo: 0,
    seasonReady: [],
    tasks: {},
    recent: {},
    revision: 1,
    turnDeadline: null,
    seasonDeadline: null,
    scheduledTurn: null,
    scheduledSeason: null,
    paused: false,
    expired: false,
  };
  sync(state, env);
  return { state, host };
}

/** 새 사람 참가자. 대기실이고 자리가 있으면 참가자, 아니면 관전자. */
export function addHuman(state: RoomState, nick: string, env: RoomEnv): Member | { error: string } {
  const clean = cleanNick(nick);
  if (!clean) return { error: 'need-nick' };
  if (state.members.length >= LIMITS.maxMembers) return { error: 'room-full' };
  const asPlayer = statusOf(state) === 'lobby' && state.seats.length < LIMITS.maxSeats;
  const m: Member = {
    id: newMemberId(env.random),
    secret: newSecret(env.random),
    nick: clean,
    tag: assignTag(state, clean, null),
    kind: 'human',
    role: asPlayer ? 'player' : 'spectator',
    ready: false,
    connected: false,
    joinedAt: env.now,
    lastSeenAt: env.now,
    disconnectedAt: env.now,
    proxy: false,
    proxyReason: null,
    lastEmoteAt: 0,
  };
  state.members.push(m);
  if (asPlayer) state.seats.push(m.id);
  touch(state, env);
  bump(state);
  return m;
}

/** 복귀: 참가자 id 와 비밀 토큰이 모두 맞아야 한다(닉네임만으로는 자리를 가져갈 수 없다). */
export function authenticate(state: RoomState, id: string, secret: string): Member | null {
  const m = member(state, id);
  if (!m || m.kind !== 'human' || !m.secret) return null;
  // 길이가 같은 문자열을 끝까지 비교(짧은 비교로 시간이 새지 않게)
  if (m.secret.length !== secret.length) return null;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= m.secret.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0 ? m : null;
}

function anyHumanConnected(state: RoomState): boolean {
  return state.members.some((m) => m.kind === 'human' && m.connected);
}

function bump(state: RoomState): void {
  state.revision += 1;
}

export function onConnect(state: RoomState, id: string, env: RoomEnv): void {
  const m = member(state, id);
  if (!m) return;
  const wasPaused = state.paused;
  m.connected = true;
  m.lastSeenAt = env.now;
  m.disconnectedAt = null;
  delete state.tasks['grace:' + id];
  if (m.proxy && m.proxyReason === 'disconnect') {
    // 돌아왔다. 이번 턴을 대리가 이미 확정했다면 다음 선택부터 직접 한다.
    m.proxy = false;
    m.proxyReason = null;
  }
  if (state.hostId === id) delete state.tasks.host;
  else {
    const host = member(state, state.hostId);
    if (host && !host.connected && host.disconnectedAt !== null && env.now - host.disconnectedAt >= dur(env, TIMING.hostGraceMs)) {
      transferHostAuto(state);
    }
  }
  state.paused = false;
  if (wasPaused) resumeAfterPause(state, env);
  touch(state, env);
  bump(state);
  sync(state, env);
}

export function onDisconnect(state: RoomState, id: string, env: RoomEnv): void {
  const m = member(state, id);
  if (!m || !m.connected) return;
  m.connected = false;
  m.disconnectedAt = env.now;
  m.lastSeenAt = env.now;
  if (statusOf(state) === 'playing' && seatOf(state, id) >= 0 && !m.proxy) {
    state.tasks['grace:' + id] = env.now + dur(env, TIMING.reconnectGraceMs);
  }
  if (state.hostId === id) state.tasks.host = env.now + dur(env, TIMING.hostGraceMs);
  state.paused = !anyHumanConnected(state);
  touch(state, env);
  bump(state);
  sync(state, env);
}

/** 실제로 살아 있는 연결 목록으로 접속 상태를 맞춘다(인스턴스 재시작 직후 등). */
export function reconcileConnections(state: RoomState, live: Set<string>, env: RoomEnv): boolean {
  let changed = false;
  for (const m of state.members) {
    if (m.kind !== 'human') continue;
    const on = live.has(m.id);
    if (m.connected && !on) {
      onDisconnect(state, m.id, env);
      changed = true;
    } else if (!m.connected && on) {
      onConnect(state, m.id, env);
      changed = true;
    }
  }
  return changed;
}

function transferHostAuto(state: RoomState): boolean {
  const candidates = [
    ...state.seats.map((id) => member(state, id)!).filter(Boolean),
    ...state.members.filter((m) => m.role === 'spectator'),
  ].filter((m) => m.kind === 'human' && m.connected && m.id !== state.hostId);
  if (!candidates.length) return false;
  state.hostId = candidates[0].id;
  delete state.tasks.host;
  return true;
}

function resumeAfterPause(state: RoomState, env: RoomEnv): void {
  // 모두 떠나 있던 동안 멈춘 마감 시각을 돌아온 사람이 행동할 수 있게 늦춘다.
  for (const key of Object.keys(state.tasks)) {
    if (key.startsWith('deadline:') && state.tasks[key] < env.now + dur(env, TIMING.resumeDeadlineMinMs)) {
      state.tasks[key] = env.now + dur(env, TIMING.resumeDeadlineMinMs);
      state.turnDeadline = state.tasks[key];
    }
    if (key.startsWith('season:') && state.tasks[key] < env.now + dur(env, TIMING.resumeDeadlineMinMs)) {
      state.tasks[key] = env.now + dur(env, TIMING.resumeDeadlineMinMs);
      state.seasonDeadline = state.tasks[key];
    }
  }
}

/**
 * 배포로 규칙·카드 데이터 버전이 바뀌었는데 진행 중인 게임이 옛 버전이면 조용히 새 규칙으로 이어 가지 않는다.
 * 게임을 대기실로 되돌리고 안내를 남긴다(끝난 게임의 결과는 그대로 둔다). 바뀌었으면 true.
 */
export function guardRulesVersion(state: RoomState, current: string, env: RoomEnv): boolean {
  const g = state.game;
  if (!g || g.phase === 'gameOver' || g.rules === current) return false;
  state.game = null;
  state.finishedAt = null;
  state.notice = '앱의 규칙·카드 데이터가 업데이트되어 진행 중이던 게임을 이어 갈 수 없습니다. 같은 자리로 새 게임을 시작해 주세요.';
  for (const m of state.members) if (m.kind === 'human') m.ready = m.id === state.hostId;
  sync(state, env);
  bump(state);
  return true;
}

export function expiryTime(state: RoomState, env?: Pick<RoomEnv, 'ttlMs'>): number {
  const finished = env?.ttlMs ?? TIMING.finishedTtlMs;
  const inactive = env?.ttlMs ?? TIMING.inactiveTtlMs;
  return state.finishedAt !== null ? state.finishedAt + finished : state.lastActivityAt + inactive;
}

/** 진행 중인 턴·계절에 맞춰 예약 작업을 정리하고 새로 건다. */
export function sync(state: RoomState, env: RoomEnv): void {
  const g = state.game;
  const turnKey = g && g.turn ? `${state.gameNo}:${g.turn.id}` : null;
  const seasonKey = g && g.phase === 'seasonEnd' ? `${state.gameNo}:${g.season}` : null;
  for (const key of Object.keys(state.tasks)) {
    if ((key.startsWith('deadline:') || key.startsWith('bot:')) && !key.endsWith(':' + turnKey)) delete state.tasks[key];
    if (key.startsWith('season:') && key !== 'season:' + seasonKey) delete state.tasks[key];
  }
  if (!turnKey) state.turnDeadline = null;
  if (!seasonKey) state.seasonDeadline = null;

  if (g && g.turn && turnKey && state.scheduledTurn !== turnKey) {
    state.scheduledTurn = turnKey;
    const secs = state.settings.turnSeconds;
    state.turnDeadline = secs ? env.now + dur(env, secs * 1000) : null;
    if (state.turnDeadline) state.tasks['deadline:' + turnKey] = state.turnDeadline;
    const rng = new Rng(mixSeed(g.seed, g.turn.id, state.gameNo, 77));
    state.seats.forEach((id, seat) => {
      const m = member(state, id);
      if (!m) return;
      if (m.kind === 'bot') {
        const delay = TIMING.botDelayMinMs + rng.next() * (TIMING.botDelayMaxMs - TIMING.botDelayMinMs);
        state.tasks[`bot:${seat}:${turnKey}`] = env.now + dur(env, delay);
      } else if (m.proxy) {
        state.tasks[`bot:${seat}:${turnKey}`] = env.now + dur(env, TIMING.proxyDelayMs);
      }
    });
  }
  if (g && seasonKey && state.scheduledSeason !== seasonKey) {
    state.scheduledSeason = seasonKey;
    state.seasonReady = [];
    // 혼자 하기(브라우저)는 사람이 "다음 계절"을 누를 때까지 기다린다.
    const pause = state.local ? 0 : dur(env, TIMING.seasonPauseMs);
    state.seasonDeadline = pause ? env.now + pause : null;
    if (pause) state.tasks['season:' + seasonKey] = env.now + pause;
  }
  if (g && g.phase === 'gameOver' && state.finishedAt === null) state.finishedAt = env.now;
  if (!state.local) state.tasks.expire = expiryTime(state, env);
}

/** 자리 한 곳에 대해 봇(또는 대리·시간 초과) 배치를 제출한다. */
function autoSubmit(state: RoomState, seat: number, level: BotLevel, by: SubmitBy, env: RoomEnv): boolean {
  const g = state.game;
  if (!g || !g.turn || g.turn.subs[seat]) return false;
  const choice = chooseBotPlacement(g, seat, level, mixSeed(g.seed, g.turn.id, seat, state.gameNo));
  const res = submitPlacement(g, seat, g.turn.id, choice.placement, by, env.now);
  if (!res.ok) {
    // 봇은 합법 배치만 고르므로 여기에 오면 안 된다. 그래도 멈추지 않도록 건너뛰기 가능 여부를 본다.
    const pass = submitPlacement(g, seat, g.turn.id, { kind: 'pass' }, by, env.now);
    return pass.ok;
  }
  return true;
}

function maybeResolve(state: RoomState, env: RoomEnv): void {
  const g = state.game;
  if (g && g.turn && allSubmitted(g)) {
    resolveTurn(g, env.now);
    sync(state, env);
  }
}

function startGame(state: RoomState, env: RoomEnv): void {
  state.gameNo += 1;
  const seed = Math.floor(env.random() * 4294967296) >>> 0;
  for (const id of state.seats) {
    const m = member(state, id)!;
    m.ready = m.kind === 'bot';
    if (m.kind === 'human' && m.proxyReason === 'host') {
      m.proxy = false;
      m.proxyReason = null;
    }
  }
  state.game = createGame({
    seed,
    mapSide: state.settings.mapSide,
    mode: state.settings.mode,
    seatCount: state.seats.length,
    now: env.now,
  });
  state.finishedAt = null;
  state.scheduledTurn = null;
  state.scheduledSeason = null;
  state.seasonReady = [];
  // 이미 끊겨 있는 사람은 곧바로 유예를 시작한다.
  for (const id of state.seats) {
    const m = member(state, id)!;
    if (m.kind === 'human' && !m.connected) state.tasks['grace:' + id] = env.now + dur(env, TIMING.reconnectGraceMs);
  }
  sync(state, env);
}

export interface CommandOutcome {
  ok: boolean;
  err?: string;
  dup?: boolean;
  changed: boolean;
  emote?: { from: string; key: string; at: number };
  removed?: string[];
}

function remember(state: RoomState, memberId: string, cmdId: string, out: CommandOutcome): void {
  const list = (state.recent[memberId] ??= []);
  list.push({ id: cmdId, ok: out.ok, err: out.err });
  if (list.length > LIMITS.recentCommands) list.splice(0, list.length - LIMITS.recentCommands);
}

/** 명령 처리. 같은 commandId 가 다시 오면 다시 실행하지 않고 처음 결과를 돌려준다. */
export function handleCommand(state: RoomState, memberId: string, cmdId: string, cmd: Command, env: RoomEnv): CommandOutcome {
  const seen = state.recent[memberId]?.find((r) => r.id === cmdId);
  if (seen) return { ok: seen.ok, err: seen.err, dup: true, changed: false };
  const out = execute(state, memberId, cmd, env);
  if (cmd.a === 'emote') return out;
  // 거절된 명령도 기록은 남긴다(같은 id 로 다시 보내면 같은 답).
  remember(state, memberId, cmdId, out);
  if (out.changed) {
    touch(state, env);
    bump(state);
  }
  return out;
}

function execute(state: RoomState, memberId: string, cmd: Command, env: RoomEnv): CommandOutcome {
  const me = member(state, memberId);
  const fail = (err: string): CommandOutcome => ({ ok: false, err, changed: false });
  const ok = (): CommandOutcome => ({ ok: true, changed: true });
  if (!me) return fail('no-member');
  const isHost = state.hostId === memberId;
  const status = statusOf(state);
  me.lastSeenAt = env.now;

  switch (cmd.a) {
    case 'emote': {
      if (env.now - me.lastEmoteAt < TIMING.emoteGapMs) return fail('emote-fast');
      me.lastEmoteAt = env.now;
      return { ok: true, changed: false, emote: { from: memberId, key: cmd.key, at: env.now } };
    }
    case 'ready': {
      if (status !== 'lobby') return fail('not-lobby');
      if (me.role !== 'player') return fail('not-player');
      me.ready = cmd.ready;
      return ok();
    }
    case 'nick': {
      if (status !== 'lobby') return fail('not-lobby');
      me.nick = cmd.nick;
      me.tag = assignTag(state, cmd.nick, me.id);
      return ok();
    }
    case 'settings': {
      if (!isHost) return fail('not-host');
      if (status !== 'lobby') return fail('not-lobby');
      state.settings = { ...state.settings, ...cmd.settings };
      return ok();
    }
    case 'addBot': {
      if (!isHost) return fail('not-host');
      if (status !== 'lobby') return fail('not-lobby');
      if (state.seats.length >= LIMITS.maxSeats) return fail('seats-full');
      if (state.members.length >= LIMITS.maxMembers) return fail('room-full');
      const used = new Set(state.members.filter((m) => m.kind === 'bot').map((m) => m.nick));
      const nick = BOT_NAMES.find((n) => !used.has(n)) ?? '봇' + (used.size + 1);
      const bot: Member = {
        id: newMemberId(env.random),
        secret: '',
        nick,
        tag: 0,
        kind: 'bot',
        botLevel: cmd.level,
        role: 'player',
        ready: true,
        connected: true,
        joinedAt: env.now,
        lastSeenAt: env.now,
        disconnectedAt: null,
        proxy: false,
        proxyReason: null,
        lastEmoteAt: 0,
      };
      bot.tag = assignTag(state, nick, bot.id);
      state.members.push(bot);
      state.seats.push(bot.id);
      return ok();
    }
    case 'removeBot': {
      if (!isHost) return fail('not-host');
      if (status !== 'lobby') return fail('not-lobby');
      const bot = member(state, cmd.memberId);
      if (!bot) return fail('no-member');
      if (bot.kind !== 'bot') return fail('not-bot');
      removeMember(state, bot.id);
      return ok();
    }
    case 'kick': {
      if (!isHost) return fail('not-host');
      if (status !== 'lobby') return fail('not-lobby');
      const target = member(state, cmd.memberId);
      if (!target) return fail('no-member');
      if (target.id === memberId) return fail('self');
      removeMember(state, target.id);
      return { ok: true, changed: true, removed: [target.id] };
    }
    case 'leave': {
      if (status === 'playing' && me.role === 'player') return fail('in-game');
      removeMember(state, me.id);
      if (state.hostId === me.id) transferHostAuto(state);
      return { ok: true, changed: true, removed: [me.id] };
    }
    case 'transferHost': {
      if (!isHost) return fail('not-host');
      const target = member(state, cmd.memberId);
      if (!target) return fail('no-member');
      if (target.kind !== 'human') return fail('not-human');
      state.hostId = target.id;
      delete state.tasks.host;
      return ok();
    }
    case 'start': {
      if (!isHost) return fail('not-host');
      if (status !== 'lobby') return fail('not-lobby');
      if (!state.seats.length) return fail('no-seats');
      const notReady = state.seats
        .map((id) => member(state, id)!)
        .filter((m) => m.kind === 'human' && m.id !== state.hostId && m.connected && !m.ready);
      if (notReady.length) return fail('not-ready');
      state.notice = null;
      startGame(state, env);
      return ok();
    }
    case 'rematch': {
      if (!isHost) return fail('not-host');
      if (status !== 'finished') return fail('not-over');
      startGame(state, env);
      return ok();
    }
    case 'toLobby': {
      if (!isHost) return fail('not-host');
      if (status !== 'finished') return fail('not-over');
      state.game = null;
      state.finishedAt = null;
      for (const m of state.members) {
        if (m.kind === 'human') m.ready = m.id === state.hostId;
        if (m.role === 'spectator' && m.kind === 'human' && state.seats.length < LIMITS.maxSeats) {
          m.role = 'player';
          state.seats.push(m.id);
        }
      }
      sync(state, env);
      return ok();
    }
    case 'place': {
      const g = state.game;
      if (!g || status !== 'playing') return fail('not-playing');
      const seat = seatOf(state, memberId);
      if (seat < 0) return fail('not-player');
      let tookBack = false;
      if (me.proxy) {
        // 직접 둔다 = 조작을 되찾는다
        me.proxy = false;
        me.proxyReason = null;
        tookBack = true;
      }
      // 클라이언트가 생각한 대상 지도가 서버가 정한 대상과 다르면 거절한다(다른 사람 지도 수정 방지).
      if (cmd.target !== undefined && g.turn && g.turn.id === cmd.turnId && g.turn.targets[seat] !== cmd.target) {
        return { ok: false, err: 'not-your-target', changed: tookBack };
      }
      const res = submitPlacement(g, seat, cmd.turnId, cmd.placement as Placement, 'self', env.now);
      if (!res.ok) return { ok: false, err: res.error as PlaceError, changed: tookBack };
      maybeResolve(state, env);
      return ok();
    }
    case 'seasonReady': {
      const g = state.game;
      if (!g || g.phase !== 'seasonEnd') return fail('not-playing');
      if (g.season !== cmd.season) return fail('bad-season');
      if (!state.seasonReady.includes(memberId)) state.seasonReady.push(memberId);
      const waiting = state.seats
        .map((id) => member(state, id)!)
        .filter((m) => m.kind === 'human' && m.connected && !m.proxy && !state.seasonReady.includes(m.id));
      if (!waiting.length) advanceSeason(state, env);
      return ok();
    }
    case 'proxy': {
      if (!isHost) return fail('not-host');
      if (status !== 'playing') return fail('not-playing');
      const target = member(state, cmd.memberId);
      if (!target || seatOf(state, target.id) < 0) return fail('no-member');
      if (target.kind !== 'human') return fail('not-human');
      target.proxy = true;
      target.proxyReason = 'host';
      scheduleProxyNow(state, seatOf(state, target.id), env);
      return ok();
    }
    case 'takeBack': {
      if (!me.proxy) return ok();
      me.proxy = false;
      me.proxyReason = null;
      const g = state.game;
      if (g && g.turn) delete state.tasks[`bot:${seatOf(state, me.id)}:${state.gameNo}:${g.turn.id}`];
      return ok();
    }
  }
}

function scheduleProxyNow(state: RoomState, seat: number, env: RoomEnv): void {
  const g = state.game;
  if (!g || !g.turn || g.turn.subs[seat]) return;
  state.tasks[`bot:${seat}:${state.gameNo}:${g.turn.id}`] = env.now + dur(env, TIMING.proxyDelayMs);
}

function advanceSeason(state: RoomState, env: RoomEnv): void {
  const g = state.game;
  if (!g || g.phase !== 'seasonEnd') return;
  startNextSeason(g, env.now);
  state.seasonReady = [];
  sync(state, env);
}

function removeMember(state: RoomState, id: string): void {
  state.members = state.members.filter((m) => m.id !== id);
  state.seats = state.seats.filter((s) => s !== id);
  delete state.recent[id];
  delete state.tasks['grace:' + id];
}

/** 게임을 진행시키는 작업(사람이 아무도 없으면 멈춘다) */
function isGameTask(key: string): boolean {
  return key.startsWith('deadline:') || key.startsWith('bot:') || key.startsWith('season:') || key.startsWith('grace:');
}

export function nextDue(state: RoomState): number | null {
  let best: number | null = null;
  for (const [key, due] of Object.entries(state.tasks)) {
    if (state.paused && isGameTask(key)) continue;
    if (best === null || due < best) best = due;
  }
  return best;
}

/** 때가 된 예약 작업을 모두 실행한다. 상태가 바뀌었으면 true. */
export function runDueTasks(state: RoomState, env: RoomEnv): boolean {
  let changed = false;
  for (let guard = 0; guard < 200; guard++) {
    const due = Object.entries(state.tasks)
      .filter(([key, at]) => at <= env.now && !(state.paused && isGameTask(key)))
      .sort((a, b) => a[1] - b[1]);
    if (!due.length) break;
    const [key] = due[0];
    delete state.tasks[key];
    if (runTask(state, key, env)) changed = true;
  }
  if (changed) bump(state);
  return changed;
}

function runTask(state: RoomState, key: string, env: RoomEnv): boolean {
  const g = state.game;
  const parts = key.split(':');
  switch (parts[0]) {
    case 'deadline': {
      const [, gameNo, turnId] = parts;
      if (!g || !g.turn || `${state.gameNo}:${g.turn.id}` !== `${gameNo}:${turnId}`) return false;
      // 시간 초과: 아직 확정하지 않은 모든 자리에 합법 배치를 대신 고른다.
      for (let seat = 0; seat < g.seatCount; seat++) {
        if (!g.turn.subs[seat]) autoSubmit(state, seat, 'easy', 'timeout', env);
      }
      maybeResolve(state, env);
      return true;
    }
    case 'bot': {
      const [, seatStr, gameNo, turnId] = parts;
      const seat = Number(seatStr);
      if (!g || !g.turn || `${state.gameNo}:${g.turn.id}` !== `${gameNo}:${turnId}`) return false;
      const m = member(state, state.seats[seat]);
      if (!m || g.turn.subs[seat]) return false;
      if (m.kind === 'bot') autoSubmit(state, seat, m.botLevel ?? 'medium', 'self', env);
      else if (m.proxy) autoSubmit(state, seat, 'easy', 'proxy', env);
      else return false;
      maybeResolve(state, env);
      return true;
    }
    case 'grace': {
      const id = parts[1];
      const m = member(state, id);
      if (!m || m.connected || statusOf(state) !== 'playing' || seatOf(state, id) < 0) return false;
      m.proxy = true;
      m.proxyReason = 'disconnect';
      scheduleProxyNow(state, seatOf(state, id), env);
      return true;
    }
    case 'host': {
      const host = member(state, state.hostId);
      if (host && host.connected) return false;
      return transferHostAuto(state);
    }
    case 'season': {
      const [, gameNo, season] = parts;
      if (!g || g.phase !== 'seasonEnd' || `${state.gameNo}:${g.season}` !== `${gameNo}:${season}`) return false;
      advanceSeason(state, env);
      return true;
    }
    case 'expire': {
      if (env.now >= expiryTime(state, env)) {
        state.expired = true;
        return true;
      }
      state.tasks.expire = expiryTime(state, env);
      return false;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ 보기 */

export function memberViews(state: RoomState): MemberView[] {
  const seated = state.seats.map((id) => member(state, id)!).filter(Boolean);
  const spectators = state.members.filter((m) => !state.seats.includes(m.id));
  return [...seated, ...spectators].map((m) => ({
    id: m.id,
    nick: m.nick,
    tag: m.tag,
    kind: m.kind,
    botLevel: m.botLevel,
    role: state.seats.includes(m.id) ? 'player' : 'spectator',
    ready: m.ready,
    connected: m.kind === 'bot' ? true : m.connected,
    proxy: m.proxy,
    proxyReason: m.proxyReason,
    seat: state.seats.indexOf(m.id),
    isHost: m.id === state.hostId,
  }));
}

/**
 * 한 사람에게 보낼 방 상태. 비공개 덱·난수 씨앗·다른 사람의 미확정 배치·비밀 토큰은 넣지 않는다.
 */
export function buildView(state: RoomState, viewerId: string | null, env: RoomEnv): RoomView {
  const g = state.game;
  const seat = viewerId ? seatOf(state, viewerId) : -1;
  const viewer = viewerId ? member(state, viewerId) : undefined;
  let game: GameView | null = null;
  if (g) {
    const over = g.phase === 'gameOver';
    game = {
      no: state.gameNo,
      rules: g.rules,
      mapSide: g.mapSide,
      mode: g.mode,
      solo: g.solo,
      seatCount: g.seatCount,
      objectives: g.objectives,
      season: g.season,
      phase: g.phase,
      column: [...g.column],
      timeUsed: columnTime(g),
      threshold: threshold(g),
      thresholds: SEASON_THRESHOLDS[g.mode],
      pendingRuins: g.pendingRuins,
      removed: [...g.removed],
      turn: g.turn
        ? {
            id: g.turn.id,
            kind: g.turn.kind,
            card: g.turn.card,
            ruins: g.turn.ruins,
            revealed: [...g.turn.revealed],
            targets: [...g.turn.targets],
            submitted: g.turn.subs.map((s) => s !== null),
            deadline: state.turnDeadline,
            startedAt: g.turn.startedAt,
            mine: seat >= 0 ? g.turn.subs[seat] : null,
          }
        : null,
      players: g.players.map((p) => ({
        board: p.board,
        coins: p.coins,
        mountainCoins: [...p.mountainCoins],
        seasons: p.seasons,
        total: totalScore(p),
        monsters: totalMonsters(p),
      })),
      events: g.events.slice(-20),
      standings: over ? standings(g) : null,
      logs: over ? g.players.map((p) => p.log) : null,
      seasonReady: [...state.seasonReady],
      seasonDeadline: state.seasonDeadline,
    };
  }
  return {
    code: state.code,
    revision: state.revision,
    serverNow: env.now,
    status: statusOf(state),
    local: state.local,
    hostId: state.hostId,
    settings: state.settings,
    members: memberViews(state),
    seats: [...state.seats],
    you: viewer
      ? { id: viewer.id, role: seat >= 0 ? 'player' : 'spectator', seat, isHost: viewer.id === state.hostId }
      : null,
    game,
    paused: state.paused,
    notice: state.notice ?? null,
    finishedAt: state.finishedAt,
    expiresAt: expiryTime(state, env),
  };
}
