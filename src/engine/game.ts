// 게임 진행 상태 기계 (순수 함수).
//
//   createGame → [탐험 공개(폐허 연속 공개 포함) → 그리기/매복 → 확인] 반복
//   → 시간 한도 도달 시 계절 채점 → 다음 계절 덱 준비 → … → 겨울 채점 후 종료
//
// 서버(Durable Object)와 브라우저(혼자 하기)가 똑같이 이 파일을 쓴다.
// 상태는 JSON 으로 그대로 저장할 수 있는 평범한 객체다. 시각(now)은 인자로 받는다.

import {
  COIN_TRACK_MAX,
  allEmpty,
  anyShapeFits,
  hasEmptyCell,
  monsterPenaltyCells,
  newlySurroundedMountains,
  placeCells,
  setCells,
  terrainChar,
  touchesRuins,
  type PlaceError,
} from './board';
import { AMBUSH_CARDS, CARDSET_VERSION, EXPLORE_CARDS, ambushCard, exploreCard, isAmbush } from './cards';
import { MAPS, initialBoard, ruinsMask, type MapDef } from './maps';
import { OBJECTIVES, OBJECTIVE_CATEGORIES, objective, type ObjectiveResult } from './objectives';
import { Rng } from './rng';
import { soloAmbushCells } from './solo';
import {
  DRAW_TERRAINS,
  N,
  TERRAIN_CHAR,
  type DrawTerrain,
  type GameEvent,
  type GameMode,
  type GameState,
  type MapSide,
  type Placement,
  type PlayerState,
  type SeasonScore,
  type SubmitBy,
  type Turn,
} from './types';

/** 진행 중인 게임의 규칙이 배포 후 조용히 바뀌지 않도록 게임 상태에 새겨 두는 버전 */
export const RULES_VERSION = 'sgjd-rules-2026.09-1';
export const CONTENT_VERSION = `${RULES_VERSION}/${CARDSET_VERSION}`;

export const SEASON_NAMES = ['봄', '여름', '가을', '겨울'] as const;
/** 계절마다 평가하는 목표 슬롯 (A=0 … D=3). 공식 지도지 점수칸: AB / BC / CD / DA */
export const SEASON_EDICTS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];
/** 계절 시간 한도. 표준은 공식 계절 카드(8/8/7/6), 빠른 모드는 이 앱의 커스텀 규칙 */
export const SEASON_THRESHOLDS: Record<GameMode, number[]> = {
  standard: [8, 8, 7, 6],
  quick: [6, 6, 5, 4],
};
export const EDICT_LETTERS = ['A', 'B', 'C', 'D'] as const;

const MAX_EVENTS = 40;

export interface GameConfig {
  seed: number;
  mapSide: MapSide;
  mode: GameMode;
  seatCount: number;
  now: number;
}

export function mapOf(state: Pick<GameState, 'mapSide'>): MapDef {
  return MAPS[state.mapSide];
}

const ruinsCache = new Map<MapSide, boolean[]>();
export function ruinsOf(state: Pick<GameState, 'mapSide'>): boolean[] {
  let m = ruinsCache.get(state.mapSide);
  if (!m) {
    m = ruinsMask(MAPS[state.mapSide]);
    ruinsCache.set(state.mapSide, m);
  }
  return m;
}

function pushEvent(state: GameState, ev: GameEvent): void {
  state.events.push(ev);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rng);
  const out = fn(rng);
  state.rng = rng.state;
  return out;
}

/** 새 게임. 첫 턴(첫 카드 공개)까지 진행한 상태를 돌려준다. */
export function createGame(cfg: GameConfig): GameState {
  if (cfg.seatCount < 1 || cfg.seatCount > 8) throw new Error('seatCount must be 1..8');
  const map = MAPS[cfg.mapSide];
  const state: GameState = {
    rules: CONTENT_VERSION,
    seed: cfg.seed >>> 0,
    rng: cfg.seed >>> 0,
    mapSide: cfg.mapSide,
    mode: cfg.mode,
    solo: cfg.seatCount === 1,
    seatCount: cfg.seatCount,
    objectives: ['', '', '', ''],
    season: 0,
    deck: [],
    ambushDeck: [],
    removed: [],
    column: [],
    pendingRuins: false,
    turnSeq: 0,
    turn: null,
    phase: 'draw',
    players: [],
    events: [],
  };
  withRng(state, (rng) => {
    // 목표 카드: 뒷면(분류)별로 한 장씩 무작위로 뽑아 A~D 에 무작위 순서로 놓는다(룰북 4쪽 5번).
    const picked = OBJECTIVE_CATEGORIES.map((cat) => rng.pick(OBJECTIVES.filter((o) => o.category === cat)).id);
    rng.shuffle(picked);
    state.objectives = picked as [string, string, string, string];
    // 매복 덱을 섞고 맨 위 한 장을 탐험 덱에 넣어 섞는다(룰북 4쪽 7·8번).
    state.ambushDeck = rng.shuffle(AMBUSH_CARDS.map((a) => a.id));
    state.deck = rng.shuffle(EXPLORE_CARDS.map((c) => c.id));
    state.deck.push(state.ambushDeck.pop()!);
    rng.shuffle(state.deck);
  });
  const board = initialBoard(map);
  for (let i = 0; i < cfg.seatCount; i++) {
    state.players.push({ board, coins: 0, mountainCoins: [], seasons: [], log: [] });
  }
  beginTurn(state, cfg.now);
  return state;
}

export function columnTime(state: GameState): number {
  let sum = 0;
  for (const id of state.column) sum += exploreCard(id)?.time ?? 0;
  return sum;
}

export function threshold(state: GameState): number {
  return SEASON_THRESHOLDS[state.mode][state.season];
}

/** 매복에서 각 자리가 그림을 그릴 지도의 주인. 자리 번호 순서를 시계 방향으로 본다. */
export function ambushTargets(seatCount: number, direction: 'cw' | 'ccw'): number[] {
  const out: number[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    // 시계 방향: 내 지도를 다음 자리(seat+1)로 넘긴다 → 나는 이전 자리(seat-1)의 지도에 그린다.
    out.push(direction === 'cw' ? (seat - 1 + seatCount) % seatCount : (seat + 1) % seatCount);
  }
  return out;
}

function addCoins(state: GameState, seat: number, count: number, reason: 'shape' | 'mountain', turnId: number): void {
  const p = state.players[seat];
  const before = p.coins;
  p.coins = Math.min(COIN_TRACK_MAX, p.coins + count);
  if (p.coins > before) pushEvent(state, { type: 'coin', turn: turnId, seat, count: p.coins - before, reason });
}

function awardMountains(state: GameState, seat: number, turnId: number): void {
  const p = state.players[seat];
  const fresh = newlySurroundedMountains(p.board, p.mountainCoins);
  if (!fresh.length) return;
  p.mountainCoins.push(...fresh);
  addCoins(state, seat, fresh.length, 'mountain', turnId);
}

/**
 * 탐험 단계: 카드를 공개한다.
 * - 폐허가 나오면 곧바로 다음 카드를 공개한다(연속 폐허도 같다).
 * - 매복이 나오면 매복 턴이 된다. 폐허 효과는 남아 다음 탐험 카드에 적용된다.
 * - 솔로 게임의 매복은 규칙대로 자동으로 그리고 계속 공개한다.
 * - 덱이 바닥나면(시간 한도에 닿기 전) 계절을 끝낸다(문서의 판정).
 */
export function beginTurn(state: GameState, now: number): void {
  let ruins = state.pendingRuins;
  let revealed: string[] = [];
  for (;;) {
    const id = state.deck.pop();
    if (id === undefined) {
      pushEvent(state, { type: 'deck-empty', season: state.season });
      state.pendingRuins = false;
      endSeason(state);
      return;
    }
    if (isAmbush(id)) {
      const card = ambushCard(id)!;
      revealed.push(id);
      state.removed.push(id);
      state.pendingRuins = ruins;
      state.turnSeq += 1;
      if (state.solo) {
        const p = state.players[0];
        const cells = soloAmbushCells(p.board, card);
        if (cells) {
          p.board = setCells(p.board, cells, TERRAIN_CHAR.monster);
          p.log.push({
            turn: state.turnSeq,
            season: state.season,
            cells,
            terrain: 'monster',
            by: -1,
            kind: 'solo-ambush',
            card: id,
            coin: false,
            auto: 'solo',
          });
          awardMountains(state, 0, state.turnSeq);
        }
        pushEvent(state, { type: 'solo-ambush', turn: state.turnSeq, card: id, cells });
        // 확인 단계: 매복은 시간이 없으므로 계절은 끝나지 않는다. 다음 카드를 공개한다.
        revealed = [];
        continue;
      }
      const targets = ambushTargets(state.seatCount, card.direction);
      state.turn = {
        id: state.turnSeq,
        season: state.season,
        kind: 'ambush',
        card: id,
        ruins: false,
        revealed,
        targets,
        subs: new Array(state.seatCount).fill(null),
        startedAt: now,
      };
      state.phase = 'ambush';
      pushEvent(state, { type: 'ambush', turn: state.turnSeq, card: id, targets });
      return;
    }
    const card = exploreCard(id)!;
    state.column.push(id);
    revealed.push(id);
    if (card.kind === 'ruins') {
      ruins = true;
      pushEvent(state, { type: 'ruins', turn: state.turnSeq + 1 });
      continue;
    }
    state.pendingRuins = false;
    state.turnSeq += 1;
    state.turn = {
      id: state.turnSeq,
      season: state.season,
      kind: 'draw',
      card: id,
      ruins,
      revealed,
      targets: Array.from({ length: state.seatCount }, (_, i) => i),
      subs: new Array(state.seatCount).fill(null),
      startedAt: now,
    };
    state.phase = 'draw';
    return;
  }
}

export interface Requirement {
  /** 그림을 그릴 지도의 주인 자리 */
  target: number;
  board: string;
  kind: 'draw' | 'ambush';
  terrains: DrawTerrain[];
  shapes: { cells: readonly (readonly [number, number])[]; coin: boolean }[];
  /** 폐허를 덮어야 하는가(가능한 경우에만 true) */
  mustCoverRuins: boolean;
  /** 폐허 효과가 걸렸지만 덮을 수 없어 1칸 대체가 된 경우 */
  ruinsUnavailable: boolean;
  /** 카드 모양을 놓을 수 없어 1칸 대체 배치를 해야 하는가 */
  mustFallback: boolean;
  fallbackTerrains: DrawTerrain[];
  /** 빈칸이 하나도 없어 건너뛸 수밖에 없는가 */
  mustPass: boolean;
}

export function requirement(state: GameState, seat: number): Requirement | null {
  const turn = state.turn;
  if (!turn) return null;
  const target = turn.targets[seat];
  const board = state.players[target].board;
  const ruins = ruinsOf(state);
  const mustPass = !hasEmptyCell(board);
  if (turn.kind === 'draw') {
    const card = exploreCard(turn.card)!;
    const shapes = card.shapes.map((s) => s.cells);
    const fits = anyShapeFits(board, shapes, ruins, turn.ruins);
    return {
      target,
      board,
      kind: 'draw',
      terrains: card.terrains,
      shapes: card.shapes,
      mustCoverRuins: turn.ruins && fits,
      ruinsUnavailable: turn.ruins && !fits,
      mustFallback: !fits && !mustPass,
      fallbackTerrains: DRAW_TERRAINS,
      mustPass,
    };
  }
  const card = ambushCard(turn.card)!;
  const fits = anyShapeFits(board, [card.cells], ruins, false);
  return {
    target,
    board,
    kind: 'ambush',
    terrains: ['monster'],
    shapes: [{ cells: card.cells, coin: false }],
    mustCoverRuins: false,
    ruinsUnavailable: false,
    mustFallback: !fits && !mustPass,
    fallbackTerrains: ['monster'],
    mustPass,
  };
}

export type CheckResult =
  | { ok: true; cells: number[]; terrain: DrawTerrain | null; coin: boolean }
  | { ok: false; error: PlaceError };

/** 배치 한 건이 지금 이 자리에서 합법인지 판정한다(상태는 바꾸지 않는다). */
export function checkPlacement(state: GameState, seat: number, placement: Placement): CheckResult {
  const turn = state.turn;
  if (!turn || (state.phase !== 'draw' && state.phase !== 'ambush')) return { ok: false, error: 'no-turn' };
  if (seat < 0 || seat >= state.seatCount) return { ok: false, error: 'no-turn' };
  const req = requirement(state, seat)!;
  const ruins = ruinsOf(state);
  if (placement.kind === 'pass') {
    return req.mustPass ? { ok: true, cells: [], terrain: null, coin: false } : { ok: false, error: 'pass-not-allowed' };
  }
  if (placement.kind === 'single') {
    if (!req.mustFallback) return { ok: false, error: 'fallback-not-allowed' };
    if (!req.fallbackTerrains.includes(placement.terrain)) return { ok: false, error: 'bad-terrain' };
    const { row, col } = placement;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= N || col < 0 || col >= N) {
      return { ok: false, error: 'out-of-bounds' };
    }
    const cells = [row * N + col];
    if (!allEmpty(req.board, cells)) return { ok: false, error: 'overlap' };
    return { ok: true, cells, terrain: placement.terrain, coin: false };
  }
  // 카드 모양
  const shape = req.shapes[placement.shape];
  if (!Number.isInteger(placement.shape) || !shape) return { ok: false, error: 'bad-shape' };
  if (!req.terrains.includes(placement.terrain)) return { ok: false, error: 'bad-terrain' };
  if (!Number.isInteger(placement.t) || placement.t < 0 || placement.t > 7) return { ok: false, error: 'bad-transform' };
  if (!Number.isInteger(placement.row) || !Number.isInteger(placement.col)) return { ok: false, error: 'out-of-bounds' };
  const cells = placeCells(shape.cells, placement.t, placement.row, placement.col);
  if (!cells) return { ok: false, error: 'out-of-bounds' };
  if (!allEmpty(req.board, cells)) return { ok: false, error: 'overlap' };
  if (turn.kind === 'draw' && turn.ruins && !touchesRuins(cells, ruins)) return { ok: false, error: 'needs-ruins' };
  return { ok: true, cells, terrain: placement.terrain, coin: turn.kind === 'draw' && shape.coin };
}

export type SubmitResult = { ok: true } | { ok: false; error: PlaceError };

/** 배치 제출(확정). 한 턴에 자리당 한 번만. */
export function submitPlacement(
  state: GameState,
  seat: number,
  turnId: number,
  placement: Placement,
  by: SubmitBy,
  now: number,
): SubmitResult {
  const turn = state.turn;
  if (!turn) return { ok: false, error: 'no-turn' };
  if (turn.id !== turnId) return { ok: false, error: 'wrong-turn' };
  if (turn.subs[seat]) return { ok: false, error: 'already-submitted' };
  const res = checkPlacement(state, seat, placement);
  if (!res.ok) return res;
  turn.subs[seat] = { placement, cells: res.cells, terrain: res.terrain, coin: res.coin, by, at: now };
  return { ok: true };
}

export function allSubmitted(state: GameState): boolean {
  return !!state.turn && state.turn.subs.every((s) => s !== null);
}

/** 모두 제출한 턴을 한꺼번에 반영하고 확인 단계를 진행한다. */
export function resolveTurn(state: GameState, now: number): void {
  const turn = state.turn;
  if (!turn || !allSubmitted(state)) throw new Error('turn not ready');
  const touched = new Set<number>();
  turn.subs.forEach((sub, seat) => {
    if (!sub) return;
    if (sub.by !== 'self') pushEvent(state, { type: 'auto', turn: turn.id, seat, by: sub.by });
    if (sub.placement.kind === 'pass' || !sub.terrain) return;
    const target = turn.targets[seat];
    const p = state.players[target];
    p.board = setCells(p.board, sub.cells, terrainChar(sub.terrain));
    p.log.push({
      turn: turn.id,
      season: state.season,
      cells: sub.cells,
      terrain: sub.terrain,
      by: seat,
      kind: turn.kind === 'ambush' ? 'ambush' : sub.placement.kind === 'single' ? 'fallback' : 'draw',
      card: turn.card,
      coin: sub.coin,
      auto: sub.by,
    });
    touched.add(target);
    if (sub.coin) addCoins(state, target, 1, 'shape', turn.id);
  });
  // 산 포위 보상: 지도 주인이 받는다(매복 몬스터로 포위가 완성되어도 같다 — 문서의 판정).
  for (const seat of touched) awardMountains(state, seat, turn.id);
  state.turn = null;
  checkPhase(state, now);
}

function checkPhase(state: GameState, now: number): void {
  if (columnTime(state) >= threshold(state)) endSeason(state);
  else beginTurn(state, now);
}

export interface SeasonDetail {
  season: number;
  edicts: [number, number];
  results: [ObjectiveResult, ObjectiveResult];
  coins: number;
  monsterCells: number[];
  total: number;
}

export function scoreBoard(state: Pick<GameState, 'objectives' | 'mapSide'>, board: string, season: number, coins: number): SeasonDetail {
  const edicts = SEASON_EDICTS[season];
  const ctx = { board, ruins: ruinsOf(state) };
  const results = edicts.map((slot) => objective(state.objectives[slot]).score(ctx)) as [ObjectiveResult, ObjectiveResult];
  const monsterCells = monsterPenaltyCells(board);
  return {
    season,
    edicts,
    results,
    coins,
    monsterCells,
    total: results[0].points + results[1].points + coins - monsterCells.length,
  };
}

function endSeason(state: GameState): void {
  state.players.forEach((p) => {
    const d = scoreBoard(state, p.board, state.season, p.coins);
    const s: SeasonScore = {
      season: state.season,
      edicts: d.edicts,
      points: [d.results[0].points, d.results[1].points],
      coins: d.coins,
      monsters: d.monsterCells.length,
      total: d.total,
    };
    p.seasons.push(s);
  });
  pushEvent(state, { type: 'season-end', season: state.season });
  state.turn = null;
  state.phase = state.season >= 3 ? 'gameOver' : 'seasonEnd';
}

/** 다음 계절 준비(룰북 9쪽): 공개한 탐험 카드를 덱에 되돌려 섞고, 매복 한 장을 더 섞어 넣는다. */
export function startNextSeason(state: GameState, now: number): boolean {
  if (state.phase !== 'seasonEnd') return false;
  withRng(state, (rng) => {
    state.deck.push(...state.column);
    state.column = [];
    rng.shuffle(state.deck);
    const next = state.ambushDeck.pop();
    if (next) {
      state.deck.push(next);
      rng.shuffle(state.deck);
    }
  });
  state.pendingRuins = false;
  state.season += 1;
  beginTurn(state, now);
  return true;
}

export function totalScore(p: PlayerState): number {
  return p.seasons.reduce((a, s) => a + s.total, 0);
}
export function totalMonsters(p: PlayerState): number {
  return p.seasons.reduce((a, s) => a + s.monsters, 0);
}

export interface Standing {
  seat: number;
  total: number;
  monsters: number;
  rank: number;
}

/** 순위: 총점 높은 순, 같으면 몬스터로 잃은 점수가 적은 순, 그래도 같으면 공동 순위(룰북 9쪽). */
export function standings(state: GameState): Standing[] {
  const rows = state.players.map((p, seat) => ({ seat, total: totalScore(p), monsters: totalMonsters(p), rank: 0 }));
  for (const r of rows) {
    r.rank = 1 + rows.filter((o) => o.total > r.total || (o.total === r.total && o.monsters < r.monsters)).length;
  }
  return rows.sort((a, b) => a.rank - b.rank || a.seat - b.seat);
}

/** 기록으로 특정 시점의 보드를 다시 만든다(다시 보기·지난 계절 강조용). */
export function boardUntil(state: Pick<GameState, 'mapSide'>, p: PlayerState, predicate: (l: PlayerState['log'][number]) => boolean): string {
  let board = initialBoard(MAPS[state.mapSide]);
  for (const l of p.log) {
    if (!predicate(l)) continue;
    board = setCells(board, l.cells, terrainChar(l.terrain));
  }
  return board;
}

export function isGameTurn(t: Turn | null): t is Turn {
  return !!t;
}
