import { describe, expect, it } from 'vitest';
import {
  AMBUSH_CARDS,
  EXPLORE_CARDS,
  MAPS,
  N,
  ambushCard,
  ambushTargets,
  cellOf,
  checkPlacement,
  columnTime,
  createGame,
  isAmbush,
  monsterPenaltyCells,
  requirement,
  resolveTurn,
  ringOrder,
  soloAmbushCells,
  standings,
  startNextSeason,
  submitPlacement,
  transform,
  uniqueVariants,
  type GameState,
  type Placement,
} from '../../src/engine';
import { at, boardFrom, gameWithDeck } from './helpers';

const place = (g: GameState, seat: number, p: Placement) => submitPlacement(g, seat, g.turn!.id, p, 'self', 0);

describe('모양 회전·반전', () => {
  it('변환 수: 대칭에 따라 서로 다른 모양만 남는다', () => {
    expect(uniqueVariants([[0, 0]]).length).toBe(1);
    expect(uniqueVariants([[0, 0], [0, 1], [0, 2]]).length).toBe(2); // 일자
    expect(uniqueVariants([[0, 0], [1, 1]]).length).toBe(2); // 대각선 2칸
    expect(uniqueVariants([[0, 0], [1, 0], [1, 1]]).length).toBe(4); // L 3칸
    expect(uniqueVariants([[0, 0], [1, 0], [1, 1], [2, 1]]).length).toBe(4); // S 4칸
    expect(uniqueVariants([[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]).length).toBe(1); // 십자
    expect(uniqueVariants([[0, 0], [1, 0], [2, 0], [2, 1]]).length).toBe(8); // L 4칸
  });
  it('시계 방향 90° 회전과 좌우 반전', () => {
    // L:  X.   회전 →  XX
    //     XX           X.
    expect(transform([[0, 0], [1, 0], [1, 1]], 1)).toEqual([[0, 0], [0, 1], [1, 0]]);
    // 반전(t=4): 좌우 뒤집기
    expect(transform([[0, 0], [1, 0], [1, 1]], 4)).toEqual([[0, 1], [1, 0], [1, 1]]);
  });
});

describe('지도 좌표(공식 지도지 대조)', () => {
  it('A면: 산 5, 폐허 6', () => {
    expect(MAPS.A.mountains).toEqual([cellOf('B4'), cellOf('C9'), cellOf('F6'), cellOf('I3'), cellOf('J8')]);
    expect(MAPS.A.ruins.length).toBe(6);
    expect(MAPS.A.waste.length).toBe(0);
  });
  it('B면: 황무지 7칸은 채워진 칸', () => {
    expect(MAPS.B.waste.length).toBe(7);
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'], mapSide: 'B' });
    // E5 는 황무지 → 겹침
    const r = checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 4, col: 4 });
    expect(r).toEqual({ ok: false, error: 'overlap' });
  });
});

describe('카드 구성', () => {
  it('탐험 13장(균열 1, 폐허 2, 지형 10) + 매복 4장', () => {
    expect(EXPLORE_CARDS.length).toBe(13);
    expect(EXPLORE_CARDS.filter((c) => c.kind === 'ruins').length).toBe(2);
    expect(EXPLORE_CARDS.filter((c) => c.kind === 'rift').length).toBe(1);
    expect(AMBUSH_CARDS.length).toBe(4);
  });
  it('모든 카드 모양은 1~5칸이고 지형은 산을 포함하지 않는다', () => {
    for (const c of EXPLORE_CARDS) {
      for (const s of c.shapes) expect(s.cells.length).toBeGreaterThanOrEqual(1);
      expect(c.terrains).not.toContain('mountain');
    }
  });
  it('게임 시작 덱: 탐험 13장 + 매복 1장, 목표는 분류별 한 장씩', () => {
    const g = createGame({ seed: 5, mapSide: 'A', mode: 'standard', seatCount: 2, now: 0 });
    const all = [...g.deck, ...g.column, ...g.removed];
    expect(all.filter((id) => !isAmbush(id)).length).toBe(13);
    expect(all.filter(isAmbush).length).toBe(1);
    expect(g.ambushDeck.length).toBe(3);
    expect(new Set(g.objectives).size).toBe(4);
  });
});

describe('배치 판정', () => {
  it('지도 밖·겹침(산) 거부, 빈칸이면 허용', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'] });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 10, col: 0 })).toEqual({ ok: false, error: 'out-of-bounds' });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 1, col: 3 })).toEqual({ ok: false, error: 'overlap' });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'forest', t: 0, row: 0, col: 0 })).toEqual({ ok: false, error: 'bad-terrain' });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 5, terrain: 'farm', t: 0, row: 0, col: 0 })).toEqual({ ok: false, error: 'bad-shape' });
    const ok = checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 0, col: 0 });
    expect(ok).toEqual({ ok: true, cells: [at(0, 0), at(1, 0)], terrain: 'farm', coin: true });
  });
  it('폐허 칸 위에는 (폐허 효과가 없어도) 그릴 수 있다', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'] });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 1, col: 5 }).ok).toBe(true);
  });
  it('모양을 놓을 수 있으면 1칸 대체 배치는 거부', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'] });
    expect(checkPlacement(g, 0, { kind: 'single', terrain: 'water', row: 0, col: 0 })).toEqual({ ok: false, error: 'fallback-not-allowed' });
  });
  it('어떤 모양도 들어가지 않으면 1칸 아무 지형(산 제외) 허용', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'] });
    // 체스판처럼 빈칸을 띄엄띄엄 남긴다 → 2칸짜리도 못 들어감
    g.players[0].board = g.players[0].board
      .split('')
      .map((ch, i) => (ch !== '.' ? ch : (Math.floor(i / N) + (i % N)) % 2 === 0 ? 'F' : '.'))
      .join('');
    const req = requirement(g, 0)!;
    expect(req.mustFallback).toBe(true);
    const empty = g.players[0].board.indexOf('.');
    expect(checkPlacement(g, 0, { kind: 'single', terrain: 'monster', row: Math.floor(empty / N), col: empty % N }).ok).toBe(true);
    expect(checkPlacement(g, 0, { kind: 'single', terrain: 'water', row: 0, col: 0 })).toEqual({ ok: false, error: 'overlap' });
  });
  it('빈칸이 전혀 없으면 건너뛰기만 가능', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'] });
    g.players[0].board = g.players[0].board.replace(/\./g, 'F');
    expect(requirement(g, 0)!.mustPass).toBe(true);
    expect(place(g, 0, { kind: 'pass' })).toEqual({ ok: true });
  });
});

describe('폐허', () => {
  it('폐허 두 장이 연속으로 나오면 한 턴에 세 장이 공개되고 폐허 효과가 걸린다', () => {
    const g = gameWithDeck({ seats: 2, deckTop: ['ruins-temple', 'ruins-outpost', 'farmland'] });
    expect(g.turn!.revealed).toEqual(['ruins-temple', 'ruins-outpost', 'farmland']);
    expect(g.turn!.ruins).toBe(true);
    expect(g.turn!.card).toBe('farmland');
  });
  it('폐허 효과: 폐허를 덮지 않으면 거부, 덮으면 허용', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['ruins-temple', 'farmland'] });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 0, col: 0 })).toEqual({ ok: false, error: 'needs-ruins' });
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 0, col: 5 }).ok).toBe(true); // A6-B6(폐허)
  });
  it('폐허가 모두 채워졌으면 1칸 대체(아무 곳, 아무 지형) — 모양 배치는 불가', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['ruins-temple', 'farmland'] });
    const arr = g.players[0].board.split('');
    for (const r of MAPS.A.ruins) arr[r] = 'V';
    g.players[0].board = arr.join('');
    const req = requirement(g, 0)!;
    expect(req.mustFallback).toBe(true);
    expect(req.ruinsUnavailable).toBe(true);
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 0, col: 0 })).toEqual({ ok: false, error: 'needs-ruins' });
    expect(checkPlacement(g, 0, { kind: 'single', terrain: 'forest', row: 0, col: 0 }).ok).toBe(true);
  });
  it('폐허 다음에 매복이 나오면 매복을 먼저 해결하고, 폐허 효과는 다음 탐험 카드에 적용', () => {
    const g = gameWithDeck({ seats: 2, deckTop: ['ruins-temple', 'goblin-raid', 'farmland'], ambushDeck: [] });
    expect(g.phase).toBe('ambush');
    expect(g.turn!.revealed).toEqual(['ruins-temple', 'goblin-raid']);
    expect(g.pendingRuins).toBe(true);
    for (const seat of [0, 1]) {
      expect(place(g, seat, { kind: 'shape', shape: 0, terrain: 'monster', t: 0, row: 0, col: 0 })).toEqual({ ok: true });
    }
    resolveTurn(g, 0);
    expect(g.turn!.card).toBe('farmland');
    expect(g.turn!.ruins).toBe(true);
    expect(g.removed).toContain('goblin-raid');
  });
});

describe('매복', () => {
  it('지도 넘기는 방향: 시계면 이전 자리, 반시계면 다음 자리의 지도에 그린다', () => {
    expect(ambushTargets(3, 'cw')).toEqual([2, 0, 1]);
    expect(ambushTargets(3, 'ccw')).toEqual([1, 2, 0]);
    expect(ambushTargets(2, 'cw')).toEqual([1, 0]);
  });
  it('매복 모양은 몬스터로만, 대상 지도에 그려진다', () => {
    const g = gameWithDeck({ seats: 3, deckTop: ['bugbear-charge'], ambushDeck: [] });
    expect(g.phase).toBe('ambush');
    expect(checkPlacement(g, 0, { kind: 'shape', shape: 0, terrain: 'forest', t: 0, row: 0, col: 0 })).toEqual({ ok: false, error: 'bad-terrain' });
    for (const seat of [0, 1, 2]) place(g, seat, { kind: 'shape', shape: 0, terrain: 'monster', t: 0, row: 0, col: 0 });
    resolveTurn(g, 0);
    // 버그베어는 시계 → 자리 0 은 자리 2 의 지도에 그렸다
    expect(g.players[2].log[0].by).toBe(0);
    expect(g.players[2].board[at(0, 0)]).toBe('M');
    expect(g.players[2].board[at(0, 2)]).toBe('M');
  });
});

describe('코인', () => {
  it('산 포위 코인은 산 하나당 한 번만', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland', 'lost-grove', 'rift'] });
    // B4(1,3) 주변: A4(0,3), C4(2,3), B3(1,2), B5(1,4)
    g.players[0].board = boardFrom(['...F.......', '..F.F......', '...........']);
    place(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 2, col: 3 }); // C4, D4 + 코인 모양
    resolveTurn(g, 0);
    expect(g.players[0].coins).toBe(2); // 모양 코인 1 + 산 포위 1
    expect(g.players[0].mountainCoins).toEqual([cellOf('B4')]);
    // 다음 턴: 다른 곳에 그려도 같은 산으로 다시 받지 않는다
    place(g, 0, { kind: 'shape', shape: 1, terrain: 'forest', t: 0, row: 5, col: 0 });
    resolveTurn(g, 0);
    expect(g.players[0].coins).toBe(2);
  });
  it('코인 칸은 14개까지', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['farmland'] });
    g.players[0].coins = 14;
    place(g, 0, { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 0, col: 0 });
    resolveTurn(g, 0);
    expect(g.players[0].coins).toBe(14);
  });
  it('이웃의 몬스터가 산 포위를 완성하면 지도 주인이 코인을 받는다', () => {
    const g = gameWithDeck({ seats: 2, deckTop: ['goblin-raid'], ambushDeck: [] });
    // 자리 1 의 B4 주변 세 칸을 채워 두고, 자리 0 이 고블린(반시계 → 자리 1 지도)으로 B5 를 채운다
    g.players[1].board = boardFrom(['...F.......', '..F........', '...F.......']);
    expect(g.turn!.targets[0]).toBe(1);
    // 고블린 대각선 3칸을 B5(1,4) C6(2,5) D7(3,6)에
    place(g, 0, { kind: 'shape', shape: 0, terrain: 'monster', t: 0, row: 1, col: 4 });
    place(g, 1, { kind: 'shape', shape: 0, terrain: 'monster', t: 0, row: 6, col: 6 });
    resolveTurn(g, 0);
    expect(g.players[1].coins).toBe(1);
    expect(g.players[0].coins).toBe(0);
  });
});

describe('몬스터 벌점', () => {
  it('여러 몬스터와 닿은 빈칸도 한 번만 센다', () => {
    const b = boardFrom(['M.M........', '...........']);
    // (0,1)은 두 몬스터와 닿지만 1칸, (1,0)(1,2)(0,3) 각각 1칸 → 4칸
    expect(monsterPenaltyCells(b).sort((a, c) => a - c)).toEqual([at(0, 1), at(0, 3), at(1, 0), at(1, 2)]);
  });
  it('대각선은 인접이 아니다', () => {
    // (0,0) 몬스터의 이웃 (0,1)=F, (1,0)=F. 대각선 (1,1)은 빈칸이지만 벌점이 아니다.
    const b = boardFrom(['MF.........', 'F..........']);
    expect(monsterPenaltyCells(b)).toEqual([]);
  });
});

describe('계절 진행과 덱', () => {
  function playToSeasonEnd(g: GameState) {
    let guard = 0;
    while ((g.phase === 'draw' || g.phase === 'ambush') && guard++ < 20) {
      const req = requirement(g, 0)!;
      let done = false;
      for (let row = 0; row < N && !done; row++) {
        for (let col = 0; col < N && !done; col++) {
          const p: Placement = req.mustFallback
            ? { kind: 'single', terrain: req.fallbackTerrains[0], row, col }
            : { kind: 'shape', shape: 0, terrain: req.terrains[0], t: 0, row, col };
          if (checkPlacement(g, 0, p).ok) {
            place(g, 0, p);
            done = true;
          }
        }
      }
      resolveTurn(g, 0);
    }
  }
  const ambushesAround = (g: GameState) => new Set([...g.deck, ...g.removed, ...(g.turn ? [g.turn.card] : [])].filter(isAmbush));

  it('시간 합이 한도(봄 8)에 닿으면 계절이 끝나고 채점된다', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['orchard-hill', 'treetop-lodge', 'misty-marsh', 'mill-stream'], ambushDeck: ['bog-troll'] });
    playToSeasonEnd(g);
    expect(g.phase).toBe('seasonEnd');
    expect(columnTime(g)).toBe(8);
    expect(g.column.length).toBe(4);
    expect(g.players[0].seasons.length).toBe(1);
    expect(g.players[0].seasons[0].edicts).toEqual([0, 1]);
  });
  it('다음 계절: 공개한 탐험 카드가 덱으로 돌아가고, 공개되지 않은 매복은 남고, 매복 한 장이 추가된다', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['orchard-hill', 'treetop-lodge', 'misty-marsh', 'mill-stream'], ambushDeck: ['bog-troll', 'bugbear-charge'] });
    g.deck.unshift('goblin-raid'); // 덱 맨 아래: 이번 계절에 공개되지 않는다
    playToSeasonEnd(g);
    expect(g.deck).toContain('goblin-raid');
    startNextSeason(g, 0);
    expect(g.season).toBe(1);
    const explore = [...g.deck, ...g.column].filter((id) => !isAmbush(id));
    expect(new Set(explore).size).toBe(13);
    const amb = ambushesAround(g);
    expect(amb.has('goblin-raid')).toBe(true);
    expect(amb.has('bugbear-charge')).toBe(true); // 매복 덱 맨 위(끝)
    expect(g.ambushDeck).toEqual(['bog-troll']);
  });
  it('겨울 채점 뒤 게임 종료', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['orchard-hill', 'treetop-lodge', 'misty-marsh'], ambushDeck: [] });
    g.season = 3; // 겨울 한도 6
    playToSeasonEnd(g);
    expect(g.phase).toBe('gameOver');
    expect(g.players[0].seasons.at(-1)!.edicts).toEqual([3, 0]);
  });
  it('빠른 모드(커스텀)는 한도 6/6/5/4', () => {
    const g = createGame({ seed: 2, mapSide: 'A', mode: 'quick', seatCount: 1, now: 0 });
    expect(g.mode).toBe('quick');
  });
});

describe('동점 처리', () => {
  it('총점이 같으면 몬스터로 잃은 점수가 적은 사람이 이긴다. 그것도 같으면 공동 순위', () => {
    const g = createGame({ seed: 1, mapSide: 'A', mode: 'standard', seatCount: 3, now: 0 });
    const s = (total: number, monsters: number) => [{ season: 0, edicts: [0, 1] as [number, number], points: [0, 0] as [number, number], coins: 0, monsters, total }];
    g.players[0].seasons = s(20, 3);
    g.players[1].seasons = s(20, 1);
    g.players[2].seasons = s(20, 3);
    const st = standings(g);
    expect(st[0]).toMatchObject({ seat: 1, rank: 1 });
    expect(st[1]).toMatchObject({ seat: 0, rank: 2 });
    expect(st[2]).toMatchObject({ seat: 2, rank: 2 });
  });
});

describe('솔로 매복', () => {
  it('둘레 순서: 모서리에서 시작해 화살표 방향으로', () => {
    const cw = ringOrder(0, 'tr', 'cw');
    expect(cw[0]).toBe(at(0, 10));
    expect(cw[1]).toBe(at(1, 10));
    const ccw = ringOrder(0, 'br', 'ccw');
    expect(ccw[0]).toBe(at(10, 10));
    expect(ccw[1]).toBe(at(9, 10)); // 반시계: 오른쪽 아래 → 위로
  });
  it('빈 지도: 고블린(오른쪽 아래, 반시계)은 오른쪽 아래 모서리에 회전 없이', () => {
    const cells = soloAmbushCells(boardFrom([]), ambushCard('goblin-raid')!);
    expect(cells).toEqual([at(8, 8), at(9, 9), at(10, 10)]);
  });
  it('가장자리가 막혀 있으면 한 칸 안쪽 둘레에서 찾는다', () => {
    const full = boardFrom([
      'FFFFFFFFFFF',
      'F.........F',
      'F.........F',
      'F.........F',
      'F.........F',
      'F.........F',
      'F.........F',
      'F.........F',
      'F.........F',
      'F.........F',
      'FFFFFFFFFFF',
    ]);
    const cells = soloAmbushCells(full, ambushCard('bugbear-charge')!)!;
    expect(cells.every((i) => Math.floor(i / N) >= 1 && Math.floor(i / N) <= 9 && i % N >= 1 && i % N <= 9)).toBe(true);
    expect(cells).toContain(at(1, 9)); // 오른쪽 위 모서리(안쪽 둘레)부터
  });
  it('어디에도 못 그리면 무시(null)', () => {
    const full = boardFrom([]).replace(/\./g, 'F');
    expect(soloAmbushCells(full, ambushCard('goblin-raid')!)).toBeNull();
  });
  it('솔로 게임에서는 매복이 자동 처리되고 매복 턴이 생기지 않는다', () => {
    const g = gameWithDeck({ seats: 1, deckTop: ['goblin-raid', 'farmland'], ambushDeck: [] });
    expect(g.turn!.kind).toBe('draw');
    expect(g.turn!.card).toBe('farmland');
    expect(g.players[0].board.split('').filter((c) => c === 'M').length).toBe(3);
    expect(g.events.some((e) => e.type === 'solo-ambush')).toBe(true);
  });
});

describe('제출 규칙', () => {
  it('한 턴에 한 번만, 지난 턴 번호는 거부', () => {
    const g = gameWithDeck({ seats: 2, deckTop: ['farmland', 'lost-grove'] });
    const p: Placement = { kind: 'shape', shape: 0, terrain: 'farm', t: 0, row: 0, col: 0 };
    expect(place(g, 0, p)).toEqual({ ok: true });
    expect(place(g, 0, p)).toEqual({ ok: false, error: 'already-submitted' });
    const old = g.turn!.id;
    place(g, 1, p);
    resolveTurn(g, 0);
    expect(submitPlacement(g, 0, old, p, 'self', 0)).toEqual({ ok: false, error: 'wrong-turn' });
  });
});

describe('덱에 매복 카드 타입', () => {
  it('매복 카드 정의에 방향·솔로 모서리가 있다', () => {
    for (const a of AMBUSH_CARDS) {
      expect(['cw', 'ccw']).toContain(a.direction);
      expect(['tl', 'tr', 'bl', 'br']).toContain(a.soloCorner);
    }
  });
});
