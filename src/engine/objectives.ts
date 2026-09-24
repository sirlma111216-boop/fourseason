// 목표(득점) 카드 16장.
// 득점 규칙은 공식 룰북 10~11쪽의 규칙 문장을 직접 대조해 구현했다(규칙 확인: official).
// 카드 이름과 설명 문장은 이 앱이 새로 쓴 것이다. 원작 이름은 ref 에만 남긴다(문서 대조용).
//
// 모든 목표 함수는 { 점수, 기여한 칸, 설명 } 을 돌려준다. 화면의 예상 점수와 서버의 확정 점수가
// 같은 함수를 쓴다.

import { NEIGHBORS, isEdge, isFilled } from './board';
import { N, TERRAIN_CHAR, type BoardString } from './types';

export type ObjectiveCategory = 'forest' | 'farmwater' | 'village' | 'space';

export interface ObjectiveResult {
  points: number;
  /** 점수의 원인이 된 칸(지도 강조용) */
  cells: number[];
  /** 짧은 계산 설명 */
  note: string;
}

export interface ScoreContext {
  board: BoardString;
  ruins: boolean[];
}

export interface Objective {
  id: string;
  name: string;
  category: ObjectiveCategory;
  /** 규칙 설명(이 앱의 문장) */
  rule: string;
  /** 문서 대조용 원작 카드 이름과 쪽 */
  ref: string;
  score(ctx: ScoreContext): ObjectiveResult;
}

export const CATEGORY_LABEL: Record<ObjectiveCategory, string> = {
  forest: '숲',
  farmwater: '농지·물',
  village: '마을',
  space: '땅의 모양',
};

const F = TERRAIN_CHAR.forest;
const V = TERRAIN_CHAR.village;
const A = TERRAIN_CHAR.farm;
const W = TERRAIN_CHAR.water;
const X = TERRAIN_CHAR.mountain;

/** 같은 지형끼리 변으로 이어진 무리 */
export function clusters(board: BoardString, ch: string): number[][] {
  const seen = new Uint8Array(board.length);
  const out: number[][] = [];
  for (let i = 0; i < board.length; i++) {
    if (seen[i] || board[i] !== ch) continue;
    const group: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const n of NEIGHBORS[cur]) {
        if (!seen[n] && board[n] === ch) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    out.push(group);
  }
  return out;
}

function adjacentTo(board: BoardString, i: number, ch: string): boolean {
  for (const n of NEIGHBORS[i]) if (board[n] === ch) return true;
  return false;
}

function cellsOf(board: BoardString, ch: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === ch) out.push(i);
  return out;
}

function clusterNeighbors(group: number[]): Set<number> {
  const inGroup = new Set(group);
  const out = new Set<number>();
  for (const g of group) for (const n of NEIGHBORS[g]) if (!inGroup.has(n)) out.add(n);
  return out;
}

export const OBJECTIVES: Objective[] = [
  // ---------------------------------------------------------------- 숲
  {
    id: 'edge-forest',
    name: '가장자리 숲',
    category: 'forest',
    rule: '지도 가장자리(바깥 테두리 줄)에 있는 숲 칸마다 1점.',
    ref: 'Sentinel Wood (룰북 10쪽)',
    score({ board }) {
      const cells = cellsOf(board, F).filter(isEdge);
      return { points: cells.length, cells, note: `가장자리 숲 ${cells.length}칸 × 1점` };
    },
  },
  {
    id: 'deep-forest',
    name: '깊은 숲',
    category: 'forest',
    rule: '상하좌우 네 방향이 모두 채워진 칸이거나 지도 가장자리인 숲 칸마다 1점.',
    ref: 'Treetower (룰북 10쪽)',
    score({ board }) {
      const cells = cellsOf(board, F).filter((i) => NEIGHBORS[i].every((n) => isFilled(board, n)));
      return { points: cells.length, cells, note: `사방이 막힌 숲 ${cells.length}칸 × 1점` };
    },
  },
  {
    id: 'green-lines',
    name: '초록 줄무늬',
    category: 'forest',
    rule: '숲이 한 칸 이상 있는 행마다 1점, 열마다 1점. 같은 숲 칸이 행과 열 모두에 쓰일 수 있다.',
    ref: 'Greenbough (룰북 10쪽)',
    score({ board }) {
      const forest = cellsOf(board, F);
      const rows = new Set(forest.map((i) => Math.floor(i / N)));
      const cols = new Set(forest.map((i) => i % N));
      return {
        points: rows.size + cols.size,
        cells: forest,
        note: `숲이 있는 행 ${rows.size}개 + 열 ${cols.size}개`,
      };
    },
  },
  {
    id: 'ridge-forest',
    name: '산등성이 숲길',
    category: 'forest',
    rule: '숲 무리 하나로 다른 산과 이어진 산마다 3점. (한 숲 무리가 산 두 개 이상에 닿으면 그 산들이 이어진 것)',
    ref: 'Stoneside Forest (룰북 10쪽)',
    score({ board }) {
      const linked = new Set<number>();
      const used: number[] = [];
      for (const group of clusters(board, F)) {
        const mountains = [...clusterNeighbors(group)].filter((n) => board[n] === X);
        if (mountains.length >= 2) {
          for (const m of mountains) linked.add(m);
          used.push(...group);
        }
      }
      return {
        points: linked.size * 3,
        cells: [...linked, ...used],
        note: `숲으로 이어진 산 ${linked.size}개 × 3점`,
      };
    },
  },
  // ---------------------------------------------------------------- 농지 · 물
  {
    id: 'irrigation',
    name: '물길 논밭',
    category: 'farmwater',
    rule: '농지와 맞닿은 물 칸마다 1점, 물과 맞닿은 농지 칸마다 1점.',
    ref: 'Canal Lake (룰북 10쪽)',
    score({ board }) {
      const waters = cellsOf(board, W).filter((i) => adjacentTo(board, i, A));
      const farms = cellsOf(board, A).filter((i) => adjacentTo(board, i, W));
      return {
        points: waters.length + farms.length,
        cells: [...waters, ...farms],
        note: `농지 옆 물 ${waters.length}칸 + 물 옆 농지 ${farms.length}칸`,
      };
    },
  },
  {
    id: 'ruin-granary',
    name: '폐허 곡창',
    category: 'farmwater',
    rule: '폐허 칸과 맞닿은 물 칸마다 1점, 폐허 칸 위에 그린 농지 칸마다 3점.',
    ref: 'The Golden Granary (룰북 10쪽)',
    score({ board, ruins }) {
      const waters = cellsOf(board, W).filter((i) => NEIGHBORS[i].some((n) => ruins[n]));
      const farms = cellsOf(board, A).filter((i) => ruins[i]);
      return {
        points: waters.length + farms.length * 3,
        cells: [...waters, ...farms],
        note: `폐허 옆 물 ${waters.length}칸 × 1점 + 폐허 위 농지 ${farms.length}칸 × 3점`,
      };
    },
  },
  {
    id: 'mountain-valley',
    name: '산골짜기',
    category: 'farmwater',
    rule: '산과 맞닿은 물 칸마다 2점, 산과 맞닿은 농지 칸마다 1점.',
    ref: 'Mages Valley (룰북 10쪽)',
    score({ board }) {
      const waters = cellsOf(board, W).filter((i) => adjacentTo(board, i, X));
      const farms = cellsOf(board, A).filter((i) => adjacentTo(board, i, X));
      return {
        points: waters.length * 2 + farms.length,
        cells: [...waters, ...farms],
        note: `산 옆 물 ${waters.length}칸 × 2점 + 산 옆 농지 ${farms.length}칸 × 1점`,
      };
    },
  },
  {
    id: 'inland',
    name: '내륙의 들과 호수',
    category: 'farmwater',
    rule: '물에도 지도 가장자리에도 닿지 않은 농지 무리마다 3점, 농지에도 지도 가장자리에도 닿지 않은 물 무리마다 3점.',
    ref: 'Shoreside Expanse (룰북 10쪽)',
    score({ board }) {
      const cells: number[] = [];
      let farmGroups = 0;
      let waterGroups = 0;
      for (const g of clusters(board, A)) {
        if (g.some(isEdge) || g.some((i) => adjacentTo(board, i, W))) continue;
        farmGroups++;
        cells.push(...g);
      }
      for (const g of clusters(board, W)) {
        if (g.some(isEdge) || g.some((i) => adjacentTo(board, i, A))) continue;
        waterGroups++;
        cells.push(...g);
      }
      return {
        points: (farmGroups + waterGroups) * 3,
        cells,
        note: `외딴 농지 무리 ${farmGroups}개 + 외딴 물 무리 ${waterGroups}개, 각 3점`,
      };
    },
  },
  // ---------------------------------------------------------------- 마을
  {
    id: 'big-towns',
    name: '큰 마을',
    category: 'village',
    rule: '마을 칸이 6칸 이상 이어진 마을 무리마다 8점.',
    ref: 'Wildholds (룰북 11쪽)',
    score({ board }) {
      const big = clusters(board, V).filter((g) => g.length >= 6);
      return {
        points: big.length * 8,
        cells: big.flat(),
        note: `6칸 이상 마을 무리 ${big.length}개 × 8점`,
      };
    },
  },
  {
    id: 'crossroads',
    name: '교차로 마을',
    category: 'village',
    rule: '서로 다른 지형 3종류 이상(숲·농지·물·몬스터·산)과 맞닿은 마을 무리마다 3점.',
    ref: 'Greengold Plains (룰북 11쪽)',
    score({ board }) {
      const counted: number[][] = [];
      for (const g of clusters(board, V)) {
        const kinds = new Set<string>();
        for (const n of clusterNeighbors(g)) {
          const ch = board[n];
          if (ch === F || ch === A || ch === W || ch === X || ch === TERRAIN_CHAR.monster) kinds.add(ch);
        }
        if (kinds.size >= 3) counted.push(g);
      }
      return {
        points: counted.length * 3,
        cells: counted.flat(),
        note: `지형 3종 이상과 닿은 마을 무리 ${counted.length}개 × 3점`,
      };
    },
  },
  {
    id: 'capital',
    name: '수도',
    category: 'village',
    rule: '산과 맞닿지 않은 마을 무리 가운데 가장 큰 무리의 칸마다 1점.',
    ref: 'Great City (룰북 11쪽)',
    score({ board }) {
      let best: number[] = [];
      for (const g of clusters(board, V)) {
        if (g.some((i) => adjacentTo(board, i, X))) continue;
        if (g.length > best.length) best = g;
      }
      return {
        points: best.length,
        cells: best,
        note: best.length ? `산과 떨어진 가장 큰 마을 ${best.length}칸 × 1점` : '산과 떨어진 마을 무리가 없습니다',
      };
    },
  },
  {
    id: 'second-city',
    name: '둘째 도시',
    category: 'village',
    rule: '두 번째로 큰 마을 무리의 칸마다 2점. 가장 큰 무리가 여럿이면 그중 하나가 두 번째가 된다.',
    ref: 'Shieldgate (룰북 11쪽)',
    score({ board }) {
      const groups = clusters(board, V).sort((a, b) => b.length - a.length);
      const second = groups[1] ?? [];
      return {
        points: second.length * 2,
        cells: second,
        note: second.length ? `두 번째로 큰 마을 ${second.length}칸 × 2점` : '마을 무리가 두 개 이상 필요합니다',
      };
    },
  },
  // ---------------------------------------------------------------- 땅의 모양
  {
    id: 'full-lines',
    name: '가득 찬 줄',
    category: 'space',
    rule: '모든 칸이 채워진 행 하나마다 6점, 열 하나마다 6점.',
    ref: 'Borderlands (룰북 11쪽)',
    score({ board }) {
      const cells: number[] = [];
      let rows = 0;
      let cols = 0;
      for (let r = 0; r < N; r++) {
        const line = Array.from({ length: N }, (_, c) => r * N + c);
        if (line.every((i) => isFilled(board, i))) {
          rows++;
          cells.push(...line);
        }
      }
      for (let c = 0; c < N; c++) {
        const line = Array.from({ length: N }, (_, r) => r * N + c);
        if (line.every((i) => isFilled(board, i))) {
          cols++;
          cells.push(...line);
        }
      }
      return { points: (rows + cols) * 6, cells, note: `가득 찬 행 ${rows}개 + 열 ${cols}개, 각 6점` };
    },
  },
  {
    id: 'old-road',
    name: '옛 대각선 길',
    category: 'space',
    rule: '지도의 왼쪽 가장자리와 아래쪽 가장자리를 잇는(왼쪽 위→오른쪽 아래 방향) 대각선 줄이 모두 채워질 때마다 3점.',
    ref: 'The Broken Road (룰북 11쪽)',
    score({ board }) {
      const cells: number[] = [];
      let lines = 0;
      for (let d = 0; d < N; d++) {
        const line: number[] = [];
        for (let i = 0; d + i < N; i++) line.push((d + i) * N + i);
        if (line.every((x) => isFilled(board, x))) {
          lines++;
          cells.push(...line);
        }
      }
      return { points: lines * 3, cells, note: `다 채운 대각선 ${lines}줄 × 3점` };
    },
  },
  {
    id: 'square-domain',
    name: '네모난 영지',
    category: 'space',
    rule: '채워진 칸으로만 이루어진 가장 큰 정사각형의 한 변 칸 수마다 3점.',
    ref: 'Lost Barony (룰북 11쪽)',
    score({ board }) {
      // 최대 정사각형 DP: best[r][c] = (r,c)를 오른쪽 아래로 하는 가장 큰 정사각형 한 변
      const dp = new Array<number>(N * N).fill(0);
      let bestK = 0;
      let bestEnd = -1;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const i = r * N + c;
          if (!isFilled(board, i)) continue;
          dp[i] = r === 0 || c === 0 ? 1 : 1 + Math.min(dp[i - N], dp[i - 1], dp[i - N - 1]);
          if (dp[i] > bestK) {
            bestK = dp[i];
            bestEnd = i;
          }
        }
      }
      const cells: number[] = [];
      if (bestK > 0) {
        const er = Math.floor(bestEnd / N);
        const ec = bestEnd % N;
        for (let r = er - bestK + 1; r <= er; r++) for (let c = ec - bestK + 1; c <= ec; c++) cells.push(r * N + c);
      }
      return { points: bestK * 3, cells, note: `가장 큰 정사각형 ${bestK}×${bestK} → 한 변 ${bestK}칸 × 3점` };
    },
  },
  {
    id: 'hollows',
    name: '움푹한 빈터',
    category: 'space',
    rule: '상하좌우 네 방향이 모두 채워진 칸이거나 지도 가장자리인 빈칸마다 1점.',
    ref: 'The Cauldrons (룰북 11쪽)',
    score({ board }) {
      const cells: number[] = [];
      for (let i = 0; i < board.length; i++) {
        if (isFilled(board, i)) continue;
        if (NEIGHBORS[i].every((n) => isFilled(board, n))) cells.push(i);
      }
      return { points: cells.length, cells, note: `사방이 막힌 빈칸 ${cells.length}칸 × 1점` };
    },
  },
];

const byId = new Map(OBJECTIVES.map((o) => [o.id, o]));

export function objective(id: string): Objective {
  const o = byId.get(id);
  if (!o) throw new Error('unknown objective ' + id);
  return o;
}

export const OBJECTIVE_CATEGORIES: ObjectiveCategory[] = ['forest', 'farmwater', 'village', 'space'];
