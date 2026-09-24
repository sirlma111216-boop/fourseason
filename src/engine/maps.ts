// 지도 정의.
// 출처: Thunderworks Games 공식 추가 지도지 PDF (CART-SheetsAB-Web.pdf) 앞면(A)·뒷면(B)을
// 직접 렌더링해 칸 좌표를 읽었다. 행 A~K → 0~10, 열 1~11 → 0~10.
// 자세한 대조 기록은 docs/rules-reference.md "지도 좌표" 절.

import { EMPTY, N, TERRAIN_CHAR, WASTE, type BoardString, type DataSource, type MapSide } from './types';

export interface MapDef {
  id: MapSide;
  name: string;
  description: string;
  mountains: number[];
  ruins: number[];
  waste: number[];
  source: DataSource;
}

/** "B4" 같은 공식 좌표를 칸 번호로 */
export function cellOf(label: string): number {
  const row = label.charCodeAt(0) - 65;
  const col = parseInt(label.slice(1), 10) - 1;
  if (row < 0 || row >= N || col < 0 || col >= N) throw new Error('bad cell ' + label);
  return row * N + col;
}

export function labelOf(cell: number): string {
  return String.fromCharCode(65 + Math.floor(cell / N)) + String((cell % N) + 1);
}

export const MAPS: Record<MapSide, MapDef> = {
  A: {
    id: 'A',
    name: '야생지 (A면)',
    description: '산 5곳, 폐허 6곳이 있는 기본 지도',
    mountains: ['B4', 'C9', 'F6', 'I3', 'J8'].map(cellOf),
    ruins: ['B6', 'C2', 'C10', 'I2', 'I10', 'J6'].map(cellOf),
    waste: [],
    source: 'official',
  },
  B: {
    id: 'B',
    name: '황무지 (B면)',
    description: '가운데에 황무지(채워진 칸) 7칸이 있는 지도',
    mountains: ['B9', 'C4', 'H6', 'I10', 'J3'].map(cellOf),
    ruins: ['B7', 'C3', 'E7', 'G2', 'H9', 'J4'].map(cellOf),
    waste: ['D6', 'E5', 'E6', 'F5', 'F6', 'F7', 'G6'].map(cellOf),
    source: 'official',
  },
};

export function initialBoard(map: MapDef): BoardString {
  const cells = new Array<string>(N * N).fill(EMPTY);
  for (const m of map.mountains) cells[m] = TERRAIN_CHAR.mountain;
  for (const w of map.waste) cells[w] = WASTE;
  return cells.join('');
}

export function ruinsMask(map: MapDef): boolean[] {
  const mask = new Array<boolean>(N * N).fill(false);
  for (const r of map.ruins) mask[r] = true;
  return mask;
}
