// 클라이언트 ↔ 방 서버 메시지 형식과 검증.
// 서버는 이 파일의 parse* 함수를 통과한 메시지만 처리한다(클라이언트를 믿지 않는다).

import type { BotLevel } from '../engine/bot';
import type { DrawTerrain, GameMode, MapSide, Placement } from '../engine/types';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 4096;
export const NICK_MAX = 12;
export const ROOM_CODE_LENGTH = 6;
/** 사람이 읽기 쉬운 글자만: 0/O, 1/I/L 처럼 헷갈리는 글자를 뺐다 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const EMOTES = ['good', 'wow', 'laugh', 'cry', 'fire', 'clap'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_LABEL: Record<Emote, { icon: string; text: string }> = {
  good: { icon: '👍', text: '좋아요' },
  wow: { icon: '😮', text: '와!' },
  laugh: { icon: '😂', text: '하하' },
  cry: { icon: '😭', text: '으앙' },
  fire: { icon: '🔥', text: '불타오른다' },
  clap: { icon: '👏', text: '박수' },
};

export type TurnSeconds = 0 | 60 | 90;

export interface RoomSettings {
  mode: GameMode;
  turnSeconds: TurnSeconds;
  hints: boolean;
  mapSide: MapSide;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'standard',
  turnSeconds: 90,
  hints: true,
  mapSide: 'A',
};

export type Command =
  | { a: 'ready'; ready: boolean }
  | { a: 'settings'; settings: Partial<RoomSettings> }
  | { a: 'addBot'; level: BotLevel }
  | { a: 'removeBot'; memberId: string }
  | { a: 'kick'; memberId: string }
  | { a: 'nick'; nick: string }
  | { a: 'leave' }
  | { a: 'start' }
  | { a: 'place'; turnId: number; placement: Placement; target?: number }
  | { a: 'seasonReady'; season: number }
  | { a: 'proxy'; memberId: string }
  | { a: 'takeBack' }
  | { a: 'transferHost'; memberId: string }
  | { a: 'rematch' }
  | { a: 'toLobby' }
  | { a: 'emote'; key: Emote };

export type ClientMessage =
  | { t: 'hello'; v: number; nick: string; resume: { id: string; secret: string } | null }
  | { t: 'cmd'; id: string; cmd: Command }
  | { t: 'sync' };

/** 닉네임 정리: 제어문자·태그 기호 제거, 앞뒤 공백 제거, 길이 제한. 글자 단위로 걸러 escape 사고를 피한다. */
export function cleanNick(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  const bad = '<>&"\'\\`';
  let out = '';
  for (const ch of s) {
    const n = ch.codePointAt(0) ?? 0;
    if (n < 0x20 || n === 0x7f || (n >= 0x200b && n <= 0x200f) || n === 0xfeff) continue;
    if (bad.includes(ch)) continue;
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return [...out].slice(0, NICK_MAX).join('');
}

export function normalizeCode(v: unknown): string {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  let out = '';
  for (const ch of s) if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
  return out.slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(v: string): boolean {
  return v.length === ROOM_CODE_LENGTH && [...v].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

const TERRAINS: DrawTerrain[] = ['forest', 'village', 'farm', 'water', 'monster'];
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40 && /^[A-Za-z0-9_-]+$/.test(v);

export function parsePlacement(v: unknown): Placement | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (p.kind === 'pass') return { kind: 'pass' };
  if (!TERRAINS.includes(p.terrain as DrawTerrain)) return null;
  if (!isInt(p.row, 0, 10) || !isInt(p.col, 0, 10)) return null;
  if (p.kind === 'single') return { kind: 'single', terrain: p.terrain as DrawTerrain, row: p.row, col: p.col };
  if (p.kind === 'shape') {
    if (!isInt(p.shape, 0, 3) || !isInt(p.t, 0, 7)) return null;
    return { kind: 'shape', shape: p.shape, terrain: p.terrain as DrawTerrain, t: p.t, row: p.row, col: p.col };
  }
  return null;
}

function parseCommand(v: unknown): Command | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  switch (c.a) {
    case 'ready':
      return typeof c.ready === 'boolean' ? { a: 'ready', ready: c.ready } : null;
    case 'settings': {
      if (!c.settings || typeof c.settings !== 'object') return null;
      const s = c.settings as Record<string, unknown>;
      const out: Partial<RoomSettings> = {};
      if (s.mode !== undefined) {
        if (s.mode !== 'standard' && s.mode !== 'quick') return null;
        out.mode = s.mode;
      }
      if (s.turnSeconds !== undefined) {
        if (s.turnSeconds !== 0 && s.turnSeconds !== 60 && s.turnSeconds !== 90) return null;
        out.turnSeconds = s.turnSeconds;
      }
      if (s.hints !== undefined) {
        if (typeof s.hints !== 'boolean') return null;
        out.hints = s.hints;
      }
      if (s.mapSide !== undefined) {
        if (s.mapSide !== 'A' && s.mapSide !== 'B') return null;
        out.mapSide = s.mapSide;
      }
      return { a: 'settings', settings: out };
    }
    case 'addBot':
      return c.level === 'easy' || c.level === 'medium' ? { a: 'addBot', level: c.level } : null;
    case 'removeBot':
    case 'kick':
    case 'proxy':
    case 'transferHost':
      return isId(c.memberId) ? ({ a: c.a, memberId: c.memberId } as Command) : null;
    case 'nick': {
      const nick = cleanNick(c.nick);
      return nick ? { a: 'nick', nick } : null;
    }
    case 'leave':
    case 'start':
    case 'takeBack':
    case 'rematch':
    case 'toLobby':
      return { a: c.a } as Command;
    case 'place': {
      if (!isInt(c.turnId, 0, 100000)) return null;
      const placement = parsePlacement(c.placement);
      if (c.target !== undefined && !isInt(c.target, 0, 7)) return null;
      return placement ? { a: 'place', turnId: c.turnId, placement, target: c.target as number | undefined } : null;
    }
    case 'seasonReady':
      return isInt(c.season, 0, 3) ? { a: 'seasonReady', season: c.season } : null;
    case 'emote':
      return EMOTES.includes(c.key as Emote) ? { a: 'emote', key: c.key as Emote } : null;
    default:
      return null;
  }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (m.t === 'sync') return { t: 'sync' };
  if (m.t === 'hello') {
    let resume: { id: string; secret: string } | null = null;
    if (m.resume && typeof m.resume === 'object') {
      const r = m.resume as Record<string, unknown>;
      if (isId(r.id) && typeof r.secret === 'string' && r.secret.length >= 16 && r.secret.length <= 64) {
        resume = { id: r.id, secret: r.secret };
      }
    }
    return { t: 'hello', v: typeof m.v === 'number' ? m.v : 0, nick: cleanNick(m.nick), resume };
  }
  if (m.t === 'cmd') {
    if (!isId(m.id)) return null;
    const cmd = parseCommand(m.cmd);
    return cmd ? { t: 'cmd', id: m.id, cmd } : null;
  }
  return null;
}
