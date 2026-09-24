import { beginTurn, createGame, initialBoard, MAPS, N, type GameState, type MapSide } from '../../src/engine';

/** 11줄 문자열로 보드를 만든다. '.' 은 지도 원래 칸(빈칸·산·황무지)을 그대로 둔다. */
export function boardFrom(rows: string[], mapSide: MapSide = 'A'): string {
  const base = initialBoard(MAPS[mapSide]).split('');
  rows.forEach((row, r) => {
    const line = row.replace(/\s+/g, '');
    for (let c = 0; c < line.length && c < N; c++) {
      if (line[c] !== '?' && line[c] !== '.') base[r * N + c] = line[c];
    }
  });
  return base.join('');
}

export const at = (r: number, c: number) => r * N + c;

/** 원하는 순서로 카드가 나오게 덱을 짠 게임. deckTop 의 첫 원소가 가장 먼저 공개된다. */
export function gameWithDeck(opts: { seats: number; deckTop: string[]; mapSide?: MapSide; ambushDeck?: string[] }): GameState {
  const g = createGame({ seed: 1, mapSide: opts.mapSide ?? 'A', mode: 'standard', seatCount: opts.seats, now: 0 });
  // 첫 턴을 되돌리고 덱을 다시 짠다.
  const rest = g.deck.filter((id) => !opts.deckTop.includes(id));
  g.deck = [...rest.filter((id) => !id.includes('goblin') && !id.includes('bugbear') && !id.includes('imps') && !id.includes('troll')), ...[...opts.deckTop].reverse()];
  g.column = [];
  g.removed = [];
  g.turn = null;
  g.turnSeq = 0;
  g.pendingRuins = false;
  g.events = [];
  if (opts.ambushDeck) g.ambushDeck = [...opts.ambushDeck];
  beginTurn(g, 0);
  return g;
}
