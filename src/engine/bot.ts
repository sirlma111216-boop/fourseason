// 봇 의사결정 (외부 AI 없음, 순수 계산).
//
// 봇이 보는 것: 현재 공개된 카드, 공개된 목표, 자기 지도(매복이면 대상 지도의 확정 상태).
// 보지 않는 것: 비공개 덱·앞으로 나올 카드, 다른 사람의 미확정 배치.
// 같은 상황에서는 같은 선택을 하도록 씨앗(seed)이 정해진 난수를 쓴다.

import { NEIGHBORS, isFilled, monsterPenaltyCells, newlySurroundedMountains, setCells, terrainChar } from './board';
import { SEASON_EDICTS, requirement, ruinsOf } from './game';
import { objective } from './objectives';
import { Rng } from './rng';
import { uniqueVariants } from './shapes';
import { N, type DrawTerrain, type GameState, type Placement } from './types';

export type BotLevel = 'easy' | 'medium';

export const BOT_LEVEL_LABEL: Record<BotLevel, string> = {
  easy: '초급',
  medium: '중급',
};

export interface Candidate {
  placement: Placement;
  cells: number[];
  terrain: DrawTerrain | null;
}

/** 지금 이 자리에서 가능한 모든 합법 배치 */
export function legalCandidates(state: GameState, seat: number): Candidate[] {
  const req = requirement(state, seat);
  if (!req) return [];
  if (req.mustPass) return [{ placement: { kind: 'pass' }, cells: [], terrain: null }];
  const board = req.board;
  const out: Candidate[] = [];
  if (req.mustFallback) {
    for (let i = 0; i < board.length; i++) {
      if (isFilled(board, i)) continue;
      for (const terrain of req.fallbackTerrains) {
        out.push({ placement: { kind: 'single', terrain, row: Math.floor(i / N), col: i % N }, cells: [i], terrain });
      }
    }
    return out;
  }
  const ruins = ruinsOf(state);
  req.shapes.forEach((shape, shapeIdx) => {
    for (const v of uniqueVariants(shape.cells)) {
      for (let row = 0; row + v.h <= N; row++) {
        for (let col = 0; col + v.w <= N; col++) {
          const cells: number[] = [];
          let ok = true;
          let ruinHit = false;
          for (const [r, c] of v.cells) {
            const i = (row + r) * N + col + c;
            if (isFilled(board, i)) {
              ok = false;
              break;
            }
            if (ruins[i]) ruinHit = true;
            cells.push(i);
          }
          if (!ok || (req.mustCoverRuins && !ruinHit)) continue;
          for (const terrain of req.terrains) {
            out.push({ placement: { kind: 'shape', shape: shapeIdx, terrain, t: v.t, row, col }, cells, terrain });
          }
        }
      }
    }
  });
  return out;
}

interface Weights {
  objectives: number[]; // 슬롯 A~D
  coin: number;
  penalty: number;
}

function weightsFor(state: GameState): Weights {
  const s = state.season;
  const objectives = [0, 0, 0, 0];
  for (let season = s; season < 4; season++) {
    const w = season === s ? 1 : Math.pow(0.8, season - s);
    for (const slot of SEASON_EDICTS[season]) objectives[slot] += w;
  }
  return {
    objectives,
    coin: 4 - s,
    penalty: 1 + 0.6 * (3 - s),
  };
}

function objectiveValue(state: GameState, board: string, w: Weights): number {
  const ctx = { board, ruins: ruinsOf(state) };
  let v = 0;
  for (let slot = 0; slot < 4; slot++) {
    if (w.objectives[slot] === 0) continue;
    v += w.objectives[slot] * objective(state.objectives[slot]).score(ctx).points;
  }
  return v;
}

function holes(board: string): number {
  let n = 0;
  for (let i = 0; i < board.length; i++) {
    if (isFilled(board, i)) continue;
    if (NEIGHBORS[i].every((x) => isFilled(board, x))) n++;
  }
  return n;
}

export interface BotChoice {
  placement: Placement;
  value: number;
  considered: number;
}

/** 봇의 배치를 고른다. 합법적인 배치만 고른다. */
export function chooseBotPlacement(state: GameState, seat: number, level: BotLevel, seed: number): BotChoice {
  const turn = state.turn;
  const cands = legalCandidates(state, seat);
  if (!turn || cands.length === 0) return { placement: { kind: 'pass' }, value: 0, considered: 0 };
  if (cands.length === 1) return { placement: cands[0].placement, value: 0, considered: 1 };

  const target = turn.targets[seat];
  const p = state.players[target];
  const w = weightsFor(state);
  const baseObj = objectiveValue(state, p.board, w);
  const basePenalty = monsterPenaltyCells(p.board).length;
  const baseHoles = level === 'medium' ? holes(p.board) : 0;
  const hollowsActive = state.objectives.some((id, slot) => id === 'hollows' && w.objectives[slot] > 0);
  const ambush = turn.kind === 'ambush';
  const coinShapes = (requirement(state, seat)?.shapes ?? []).map((s) => s.coin);

  const scored = cands.map((c) => {
    if (!c.terrain) return { c, value: 0 };
    const board = setCells(p.board, c.cells, terrainChar(c.terrain));
    const dObj = objectiveValue(state, board, w) - baseObj;
    const dPen = monsterPenaltyCells(board).length - basePenalty;
    const shapeCoin = !ambush && c.placement.kind === 'shape' && coinShapes[c.placement.shape] ? 1 : 0;
    const coins = newlySurroundedMountains(board, p.mountainCoins).length + shapeCoin;
    if (ambush) {
      // 대상 지도에 주는 피해: 벌점 증가는 좋고, 상대 점수·코인을 올려 주는 것은 나쁘다.
      const value = dPen * w.penalty - dObj - coins * w.coin;
      return { c, value };
    }
    let value = dObj + coins * w.coin - dPen * w.penalty;
    if (c.terrain === 'monster') value -= 3; // 자기 지도에 몬스터는 거의 언제나 손해
    if (level === 'medium' && !hollowsActive) value -= 0.35 * (holes(board) - baseHoles);
    return { c, value };
  });

  const rng = new Rng(seed);
  // 같은 값이면 난수로 섞어 매번 같은 구석만 고르지 않게 한다(씨앗이 같으면 결과도 같다).
  const jitter = scored.map((s) => ({ ...s, tie: rng.next() }));
  jitter.sort((a, b) => b.value - a.value || a.tie - b.tie);

  if (level === 'easy') {
    const top = jitter.slice(0, Math.min(6, jitter.length));
    const pick = top[rng.int(top.length)];
    return { placement: pick.c.placement, value: pick.value, considered: cands.length };
  }
  return { placement: jitter[0].c.placement, value: jitter[0].value, considered: cands.length };
}
