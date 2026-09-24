// 다각형(폴리오미노) 모양의 회전·반전.
// 좌표는 [행, 열]. 행은 아래로, 열은 오른쪽으로 커진다.
// 변환 번호 t (0~7): t % 4 = 시계 방향 90° 회전 횟수, t >= 4 이면 먼저 좌우 반전.

import type { Coord, ShapeCells } from './types';

export function normalize(cells: ShapeCells): Coord[] {
  let minR = Infinity;
  let minC = Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  return cells
    .map(([r, c]) => [r - minR, c - minC] as Coord)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function transform(cells: ShapeCells, t: number): Coord[] {
  const flip = t >= 4;
  const rot = ((t % 4) + 4) % 4;
  let out: Coord[] = cells.map(([r, c]) => (flip ? [r, -c] : [r, c]) as Coord);
  for (let i = 0; i < rot; i++) {
    // 시계 방향 90°: (r, c) -> (c, -r)
    out = out.map(([r, c]) => [c, -r] as Coord);
  }
  return normalize(out);
}

export function shapeKey(cells: ShapeCells): string {
  return normalize(cells)
    .map(([r, c]) => r + ',' + c)
    .join(';');
}

export interface Variant {
  t: number;
  cells: Coord[];
  h: number;
  w: number;
}

const variantCache = new Map<string, Variant[]>();

/** 서로 다른 모양만 남긴 변환 목록(봇·합법 판정에서 중복 계산을 줄인다) */
export function uniqueVariants(cells: ShapeCells): Variant[] {
  const key = shapeKey(cells);
  const hit = variantCache.get(key);
  if (hit) return hit;
  const seen = new Set<string>();
  const out: Variant[] = [];
  for (let t = 0; t < 8; t++) {
    const v = transform(cells, t);
    const k = shapeKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    const { h, w } = size(v);
    out.push({ t, cells: v, h, w });
  }
  variantCache.set(key, out);
  return out;
}

export function size(cells: ShapeCells): { h: number; w: number } {
  let h = 0;
  let w = 0;
  for (const [r, c] of cells) {
    if (r + 1 > h) h = r + 1;
    if (c + 1 > w) w = c + 1;
  }
  return { h, w };
}

/**
 * 모양의 "손잡이" 칸: 화면에서 칸을 누르면 이 칸이 누른 자리에 온다.
 * 무게중심에 가장 가까운 칸을 고르므로 회전해도 손가락 아래에 머문다.
 */
export function pivotOf(cells: ShapeCells): Coord {
  let sr = 0;
  let sc = 0;
  for (const [r, c] of cells) {
    sr += r;
    sc += c;
  }
  const cr = sr / cells.length;
  const cc = sc / cells.length;
  let best = cells[0];
  let bestD = Infinity;
  for (const cell of cells) {
    const d = (cell[0] - cr) ** 2 + (cell[1] - cc) ** 2;
    if (d < bestD - 1e-9) {
      bestD = d;
      best = cell;
    }
  }
  return best;
}
