// 솔로 모드 매복 (룰북 12쪽 "Changes to Ambushes").
// 매복 카드 오른쪽 위 격자가 가리키는 모서리에서 출발해, 카드의 화살표 방향(시계/반시계)으로
// 지도 가장자리를 따라가며 몬스터 모양을 회전·반전 없이 그릴 수 있는 첫 자리를 찾는다.
// 가장자리에서 안 되면 한 칸 안쪽 둘레에서 같은 모서리·같은 방향으로 다시 찾는다.
// 끝내 못 그리면 그 매복 카드는 무시한다(null).
//
// 룰북이 정하지 않은 세부(한 둘레 칸에 모양을 대는 여러 방법 중 무엇을 먼저 시도하나)는
// 문서의 "판정" 절에 적은 대로 결정적으로 정했다.

import { isFilled } from './board';
import { normalize } from './shapes';
import { N, type BoardString, type ShapeCells } from './types';
import type { AmbushCard } from './cards';

/** 둘레 k(0 = 가장자리)의 칸을 왼쪽 위 모서리부터 시계 방향으로 */
export function ringClockwise(k: number): number[] {
  const lo = k;
  const hi = N - 1 - k;
  if (lo > hi) return [];
  if (lo === hi) return [lo * N + lo];
  const out: number[] = [];
  for (let c = lo; c <= hi; c++) out.push(lo * N + c);
  for (let r = lo + 1; r <= hi; r++) out.push(r * N + hi);
  for (let c = hi - 1; c >= lo; c--) out.push(hi * N + c);
  for (let r = hi - 1; r > lo; r--) out.push(r * N + lo);
  return out;
}

export function ringOrder(k: number, corner: AmbushCard['soloCorner'], direction: AmbushCard['direction']): number[] {
  const ring = ringClockwise(k);
  if (ring.length <= 1) return ring;
  const lo = k;
  const hi = N - 1 - k;
  const cornerCell = { tl: lo * N + lo, tr: lo * N + hi, br: hi * N + hi, bl: hi * N + lo }[corner];
  const start = ring.indexOf(cornerCell);
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const idx = direction === 'cw' ? (start + i) % ring.length : (start - i + ring.length) % ring.length;
    out.push(ring[idx]);
  }
  return out;
}

/** 솔로 매복으로 몬스터가 놓일 칸. 놓을 수 없으면 null. */
export function soloAmbushCells(board: BoardString, card: AmbushCard): number[] | null {
  const shape: ShapeCells = normalize(card.cells);
  for (let k = 0; 2 * k < N; k++) {
    const lo = k;
    const hi = N - 1 - k;
    for (const target of ringOrder(k, card.soloCorner, card.direction)) {
      const tr = Math.floor(target / N);
      const tc = target % N;
      // 모양의 칸 하나하나를 차례로 target 칸에 대 본다(모양 칸은 읽는 순서).
      for (const [sr, sc] of shape) {
        const or = tr - sr;
        const oc = tc - sc;
        const cells: number[] = [];
        let ok = true;
        for (const [r, c] of shape) {
          const rr = or + r;
          const cc = oc + c;
          if (rr < lo || rr > hi || cc < lo || cc > hi) {
            ok = false;
            break;
          }
          const i = rr * N + cc;
          if (isFilled(board, i)) {
            ok = false;
            break;
          }
          cells.push(i);
        }
        if (ok) return cells;
      }
    }
  }
  return null;
}
