// 방 상태와 화면으로 내려가는 보기(View) 타입.

import type { BotLevel } from '../engine/bot';
import type { Standing } from '../engine/game';
import type { GameEvent, GameState, PlacementLog, SeasonScore, Submission } from '../engine/types';
import type { RoomSettings } from '../shared/protocol';

export interface Member {
  id: string;
  /** 복귀용 비밀 토큰. 사람에게만 있다. 다른 참가자에게 절대 보내지 않는다. */
  secret: string;
  nick: string;
  /** 같은 닉네임을 구분하는 번호(0이면 표시하지 않음) */
  tag: number;
  kind: 'human' | 'bot';
  botLevel?: BotLevel;
  role: 'player' | 'spectator';
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
  disconnectedAt: number | null;
  /** 임시 봇(대리 진행)이 이 자리를 맡고 있는가 */
  proxy: boolean;
  proxyReason: 'disconnect' | 'host' | null;
  lastEmoteAt: number;
}

export interface RecentCommand {
  id: string;
  ok: boolean;
  err?: string;
}

export interface RoomState {
  v: 1;
  code: string;
  /** 브라우저 안에서만 도는 혼자 하기/봇 대전 방인가 */
  local: boolean;
  createdAt: number;
  /** 마지막 활동 시각(명령·접속·진행). 비활성 만료 기준 */
  lastActivityAt: number;
  /** 게임이 끝난 시각. 결과 보관 만료 기준 */
  finishedAt: number | null;
  hostId: string;
  settings: RoomSettings;
  members: Member[];
  /** 자리 순서(= 시계 방향). 게임 중에는 바뀌지 않는다. */
  seats: string[];
  game: GameState | null;
  gameNo: number;
  seasonReady: string[];
  /** 예약 작업: 키 → 실행 시각(ms). Durable Object alarm 하나를 여러 작업이 나눠 쓴다. */
  tasks: Record<string, number>;
  recent: Record<string, RecentCommand[]>;
  revision: number;
  turnDeadline: number | null;
  seasonDeadline: number | null;
  scheduledTurn: string | null;
  scheduledSeason: string | null;
  /** 사람이 아무도 접속해 있지 않아 진행을 멈춘 상태 */
  paused: boolean;
  /** 만료되어 지워야 하는 방 */
  expired: boolean;
  /** 모두에게 보여 줄 안내(예: 규칙 데이터 갱신으로 게임을 이어 갈 수 없음) */
  notice?: string | null;
}

export interface MemberView {
  id: string;
  nick: string;
  tag: number;
  kind: 'human' | 'bot';
  botLevel?: BotLevel;
  role: 'player' | 'spectator';
  ready: boolean;
  connected: boolean;
  proxy: boolean;
  proxyReason: 'disconnect' | 'host' | null;
  seat: number;
  isHost: boolean;
}

export interface TurnView {
  id: number;
  kind: 'draw' | 'ambush';
  card: string;
  ruins: boolean;
  revealed: string[];
  targets: number[];
  submitted: boolean[];
  /** 자동 처리된 자리(시간 초과·대리) — 확정 후에만 공개 */
  deadline: number | null;
  startedAt: number;
  /** 내 제출(나에게만) */
  mine: Submission | null;
}

export interface PlayerView {
  board: string;
  coins: number;
  mountainCoins: number[];
  seasons: SeasonScore[];
  total: number;
  monsters: number;
}

export interface GameView {
  no: number;
  rules: string;
  mapSide: GameState['mapSide'];
  mode: GameState['mode'];
  solo: boolean;
  seatCount: number;
  objectives: GameState['objectives'];
  season: number;
  phase: GameState['phase'];
  column: string[];
  timeUsed: number;
  threshold: number;
  thresholds: number[];
  pendingRuins: boolean;
  removed: string[];
  turn: TurnView | null;
  players: PlayerView[];
  events: GameEvent[];
  standings: Standing[] | null;
  logs: PlacementLog[][] | null;
  seasonReady: string[];
  seasonDeadline: number | null;
}

export interface RoomView {
  code: string;
  revision: number;
  serverNow: number;
  status: 'lobby' | 'playing' | 'finished';
  local: boolean;
  hostId: string;
  settings: RoomSettings;
  members: MemberView[];
  seats: string[];
  you: { id: string; role: 'player' | 'spectator'; seat: number; isHost: boolean } | null;
  game: GameView | null;
  paused: boolean;
  notice: string | null;
  finishedAt: number | null;
  expiresAt: number;
}

export type ServerMessage =
  | { t: 'welcome'; you: { id: string; secret?: string }; room: RoomView }
  | { t: 'state'; room: RoomView }
  | { t: 'ack'; id: string; ok: boolean; err?: string; dup?: boolean }
  | { t: 'emote'; from: string; key: string; at: number }
  | { t: 'error'; code: 'expired' | 'not-found' | 'bad-token' | 'room-full' | 'bad-message' | 'rate-limit' | 'need-nick' | 'server'; message: string }
  | { t: 'replaced'; message: string }
  | { t: 'kicked'; message: string };
