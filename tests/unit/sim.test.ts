// 엔진만으로 게임 전체를 끝까지 돌려 보는 시뮬레이션(네트워크 없이).
import { describe, expect, it } from 'vitest';
import {
  allSubmitted,
  chooseBotPlacement,
  createGame,
  legalCandidates,
  mixSeed,
  resolveTurn,
  standings,
  startNextSeason,
  submitPlacement,
  totalScore,
  type BotLevel,
  type GameState,
} from '../../src/engine';

export function playOut(state: GameState, levels: BotLevel[], onTurn?: (s: GameState) => void): GameState {
  let guard = 0;
  while (state.phase !== 'gameOver') {
    if (++guard > 500) throw new Error('game did not finish');
    if (state.phase === 'seasonEnd') {
      startNextSeason(state, 0);
      continue;
    }
    const turn = state.turn!;
    for (let seat = 0; seat < state.seatCount; seat++) {
      if (turn.subs[seat]) continue;
      const choice = chooseBotPlacement(state, seat, levels[seat % levels.length], mixSeed(state.seed, turn.id, seat));
      const res = submitPlacement(state, seat, turn.id, choice.placement, 'self', 0);
      expect(res).toEqual({ ok: true });
    }
    expect(allSubmitted(state)).toBe(true);
    onTurn?.(state);
    resolveTurn(state, 0);
  }
  return state;
}

describe('full game simulation', () => {
  it('two medium bots finish a standard game on map A', () => {
    const g = playOut(createGame({ seed: 42, mapSide: 'A', mode: 'standard', seatCount: 2, now: 0 }), ['medium']);
    expect(g.phase).toBe('gameOver');
    for (const p of g.players) expect(p.seasons).toHaveLength(4);
    expect(standings(g)).toHaveLength(2);
  });

  it('solo game finishes with solo ambush handled automatically', () => {
    const g = playOut(createGame({ seed: 7, mapSide: 'B', mode: 'standard', seatCount: 1, now: 0 }), ['medium']);
    expect(g.phase).toBe('gameOver');
    expect(g.players[0].seasons).toHaveLength(4);
  });

  it('8 seats (mixed levels) finish; measure time per bot move', () => {
    const t0 = performance.now();
    let moves = 0;
    const g = playOut(createGame({ seed: 99, mapSide: 'A', mode: 'standard', seatCount: 8, now: 0 }), ['medium', 'easy'], (s) => {
      moves += s.seatCount;
    });
    const ms = performance.now() - t0;
    expect(g.phase).toBe('gameOver');
    console.log(`8-seat game: ${moves} bot moves in ${ms.toFixed(0)}ms (${(ms / moves).toFixed(1)}ms/move)`);
  });

  it('score distribution for medium solo (calibration)', () => {
    const scores: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const g = playOut(createGame({ seed, mapSide: 'A', mode: 'standard', seatCount: 1, now: 0 }), ['medium']);
      scores.push(totalScore(g.players[0]));
    }
    scores.sort((a, b) => a - b);
    console.log('medium solo scores', scores.join(','));
    expect(scores.length).toBe(20);
  });

  it('random legal players never produce illegal states', () => {
    for (let seed = 100; seed < 110; seed++) {
      const g = createGame({ seed, mapSide: seed % 2 ? 'A' : 'B', mode: 'quick', seatCount: 3, now: 0 });
      let guard = 0;
      while (g.phase !== 'gameOver' && guard++ < 500) {
        if (g.phase === 'seasonEnd') {
          startNextSeason(g, 0);
          continue;
        }
        const turn = g.turn!;
        for (let seat = 0; seat < g.seatCount; seat++) {
          const cands = legalCandidates(g, seat);
          expect(cands.length).toBeGreaterThan(0);
          const c = cands[(seed * 31 + turn.id * 7 + seat) % cands.length];
          expect(submitPlacement(g, seat, turn.id, c.placement, 'self', 0)).toEqual({ ok: true });
        }
        resolveTurn(g, 0);
      }
      expect(g.phase).toBe('gameOver');
    }
  });
});
