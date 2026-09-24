// 화면으로 내려간 보기(GameView)를 규칙 엔진 함수(requirement·checkPlacement·봇)에 넣을 수 있는 모양으로.
// 비공개 정보(덱·씨앗)는 비어 있다. 클라이언트의 예상 판정과 시험 클라이언트가 함께 쓴다.

import type { GameState } from '../engine/types';
import type { GameView } from './types';

export function engineState(g: GameView): GameState {
  return {
    rules: g.rules,
    seed: 0,
    rng: 0,
    mapSide: g.mapSide,
    mode: g.mode,
    solo: g.solo,
    seatCount: g.seatCount,
    objectives: g.objectives,
    season: g.season,
    deck: [],
    ambushDeck: [],
    removed: g.removed,
    column: g.column,
    pendingRuins: g.pendingRuins,
    turnSeq: g.turn?.id ?? 0,
    turn: g.turn
      ? {
          id: g.turn.id,
          season: g.season,
          kind: g.turn.kind,
          card: g.turn.card,
          ruins: g.turn.ruins,
          revealed: g.turn.revealed,
          targets: g.turn.targets,
          subs: g.turn.submitted.map(() => null),
          startedAt: g.turn.startedAt,
        }
      : null,
    phase: g.phase,
    players: g.players.map((p) => ({ board: p.board, coins: p.coins, mountainCoins: p.mountainCoins, seasons: p.seasons, log: [] })),
    events: g.events,
  };
}
