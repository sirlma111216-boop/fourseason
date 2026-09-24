// 보드 판정: 이웃, 채워진 칸, 배치 합법성, 산 포위 코인, 몬스터 벌점.

import { size, transform, uniqueVariants } from './shapes';
import { EMPTY, N, TERRAIN_CHAR, type BoardString, type DrawTerrain, type ShapeCells } from './types';

export const COIN_TRACK_MAX = 14; // 공식 지도지의 코인 칸 수

/** 칸마다 상하좌우 이웃(지도 밖 제외) */
export const NEIGHBORS: number[][] = (() => {
  const out: number[][] = [];
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N);
    const c = i % N;
    const list: number[] = [];
    if (r > 0) list.push(i - N);
    if (r < N - 1) list.push(i + N);
    if (c > 0) list.push(i - 1);
    if (c < N - 1) list.push(i + 1);
    out.push(list);
  }
  return out;
})();

export function isEdge(i: number): boolean {
  const r = Math.floor(i / N);
  const c = i % N;
  return r === 0 || c === 0 || r === N - 1 || c === N - 1;
}

/** 채워진 칸: 지형(산·몬스터 포함)이 있거나 황무지. 폐허는 그 위에 그렸을 때만 채워진다. */
export function isFilled(board: BoardString, i: number): boolean {
  return board.charCodeAt(i) !== 46; // '.'
}

export function setCells(board: BoardString, cells: number[], ch: string): BoardString {
  const arr = board.split('');
  for (const i of cells) arr[i] = ch;
  return arr.join('');
}

export type PlaceError =
  | 'out-of-bounds'
  | 'overlap'
  | 'needs-ruins'
  | 'bad-shape'
  | 'bad-terrain'
  | 'bad-transform'
  | 'fallback-not-allowed'
  | 'pass-not-allowed'
  | 'wrong-turn'
  | 'already-submitted'
  | 'not-your-target'
  | 'no-turn';

export const PLACE_ERROR_TEXT: Record<PlaceError, string> = {
  'out-of-bounds': '지도 밖으로 나갑니다',
  overlap: '이미 채워진 칸과 겹칩니다',
  'needs-ruins': '폐허 칸을 하나 이상 덮어야 합니다',
  'bad-shape': '이 카드에 없는 모양입니다',
  'bad-terrain': '이 카드에서 고를 수 없는 지형입니다',
  'bad-transform': '회전·반전 값이 올바르지 않습니다',
  'fallback-not-allowed': '카드의 모양을 놓을 자리가 있어 1칸 대체 배치를 할 수 없습니다',
  'pass-not-allowed': '아직 빈칸이 있어 건너뛸 수 없습니다',
  'wrong-turn': '이미 지나간 턴의 제출입니다',
  'already-submitted': '이미 배치를 확정했습니다',
  'not-your-target': '이번 매복에서 그릴 수 있는 지도가 아닙니다',
  'no-turn': '지금은 배치할 차례가 아닙니다',
};

/** 모양을 변환 t 로 돌리고 (row, col)을 왼쪽 위 기준점으로 놓았을 때의 칸 번호. 지도 밖이면 null. */
export function placeCells(cells: ShapeCells, t: number, row: number, col: number): number[] | null {
  const v = transform(cells, t);
  const out: number[] = [];
  for (const [r, c] of v) {
    const rr = row + r;
    const cc = col + c;
    if (rr < 0 || rr >= N || cc < 0 || cc >= N) return null;
    out.push(rr * N + cc);
  }
  return out;
}

export function allEmpty(board: BoardString, cells: number[]): boolean {
  for (const i of cells) if (isFilled(board, i)) return false;
  return true;
}

export function touchesRuins(cells: number[], ruins: boolean[]): boolean {
  for (const i of cells) if (ruins[i]) return true;
  return false;
}

export function hasEmptyRuins(board: BoardString, ruins: boolean[]): boolean {
  for (let i = 0; i < ruins.length; i++) if (ruins[i] && !isFilled(board, i)) return true;
  return false;
}

export function hasEmptyCell(board: BoardString): boolean {
  return board.indexOf(EMPTY) >= 0;
}

/**
 * 주어진 모양들 중 하나라도(회전·반전 포함) 합법적으로 놓을 수 있는가.
 * needRuins 이면 폐허 칸을 하나 이상 덮어야 한다.
 */
export function anyShapeFits(
  board: BoardString,
  shapes: ShapeCells[],
  ruins: boolean[],
  needRuins: boolean,
  allowTransform = true,
): boolean {
  for (const cells of shapes) {
    const variants = allowTransform ? uniqueVariants(cells) : [{ t: 0, cells: transform(cells, 0), ...size(transform(cells, 0)) }];
    for (const v of variants) {
      for (let row = 0; row + v.h <= N; row++) {
        for (let col = 0; col + v.w <= N; col++) {
          let ok = true;
          let ruinHit = false;
          for (const [r, c] of v.cells) {
            const i = (row + r) * N + col + c;
            if (board.charCodeAt(i) !== 46) {
              ok = false;
              break;
            }
            if (ruins[i]) ruinHit = true;
          }
          if (ok && (!needRuins || ruinHit)) return true;
        }
      }
    }
  }
  return false;
}

/** 새로 둘러싸인 산(네 이웃이 모두 채워짐) 가운데 아직 코인을 받지 않은 것 */
export function newlySurroundedMountains(board: BoardString, rewarded: number[]): number[] {
  const out: number[] = [];
  const mountain = TERRAIN_CHAR.mountain;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== mountain) continue;
    if (rewarded.includes(i)) continue;
    // 공식 지도의 산은 모두 가장자리에서 떨어져 있어 이웃이 항상 4칸이다.
    // 혹시 가장자리 산이 있다면 지도 밖은 막힌 것으로 본다(문서의 판정 참고).
    if (NEIGHBORS[i].every((n) => isFilled(board, n))) out.push(i);
  }
  return out;
}

/** 몬스터 벌점: 몬스터 칸과 맞닿은 빈칸의 수. 한 빈칸이 여러 몬스터와 닿아도 1번만 센다. */
export function monsterPenaltyCells(board: BoardString): number[] {
  const out: number[] = [];
  const monster = TERRAIN_CHAR.monster;
  for (let i = 0; i < board.length; i++) {
    if (isFilled(board, i)) continue;
    for (const n of NEIGHBORS[i]) {
      if (board[n] === monster) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

export function terrainChar(t: DrawTerrain): string {
  return TERRAIN_CHAR[t];
}
