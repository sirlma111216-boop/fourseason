// 탐험 카드 · 매복 카드 데이터 (선언적).
//
// source: 'official'  공식 룰북 그림에서 시간·지형·모양·코인(매복은 방향·솔로 모서리)을
//                     직접 확인한 카드. 이름은 이 앱이 새로 붙인 한국어 이름이다.
// source: 'custom'    공식 자료에서 앞면을 확인할 수 없어 이 앱이 새로 만든 카드.
//                     원작 카드의 재현이 아니다. 화면에 "커스텀" 표시가 붙는다.
//
// 카드 구성(탐험 13장 = 균열 1 + 폐허 2 + 지형 10, 매복 4장)은 룰북 3쪽 구성품 목록을 따른다.
// 대조 기록: docs/rules-reference.md "카드 데이터".

import type { DataSource, DrawTerrain, ShapeCells } from './types';

export const CARDSET_VERSION = 'cards-2026.09-1';

export interface ShapeOption {
  cells: ShapeCells;
  coin: boolean;
}

export interface ExploreCard {
  id: string;
  name: string;
  kind: 'explore' | 'ruins' | 'rift';
  /** 모래시계(시간) 값 */
  time: number;
  terrains: DrawTerrain[];
  shapes: ShapeOption[];
  source: DataSource;
  /** 문서 대조용: 확인한 공식 카드 이름과 쪽 */
  ref?: string;
}

export interface AmbushCard {
  id: string;
  name: string;
  cells: ShapeCells;
  /** 지도를 넘기는 방향: 시계(cw) / 반시계(ccw) */
  direction: 'cw' | 'ccw';
  /** 솔로 모드에서 몬스터를 그리기 시작할 지도 모서리 */
  soloCorner: 'tl' | 'tr' | 'bl' | 'br';
  source: DataSource;
  ref?: string;
}

const ONE: ShapeCells = [[0, 0]];

export const EXPLORE_CARDS: ExploreCard[] = [
  // ---- 공식 룰북 그림으로 확인한 카드 -------------------------------------
  {
    id: 'rift',
    name: '균열의 땅',
    kind: 'rift',
    time: 0,
    terrains: ['forest', 'village', 'farm', 'water', 'monster'],
    shapes: [{ cells: ONE, coin: false }],
    source: 'official',
    ref: 'Rift Lands — 룰북 3·7쪽 (시간 0, 1x1, 숲·마을·농지·물·몬스터)',
  },
  {
    id: 'ruins-temple',
    name: '사원 폐허',
    kind: 'ruins',
    time: 0,
    terrains: [],
    shapes: [],
    source: 'official',
    ref: 'Temple Ruins — 룰북 5·8쪽 (시간 0)',
  },
  {
    id: 'ruins-outpost',
    name: '초소 폐허',
    kind: 'ruins',
    time: 0,
    terrains: [],
    shapes: [],
    source: 'official',
    ref: 'Outpost Ruins — 룰북 7쪽 (폐허 카드)',
  },
  {
    id: 'lost-grove',
    name: '잊힌 숲',
    kind: 'explore',
    time: 1,
    terrains: ['forest'],
    shapes: [
      { cells: [[0, 0], [1, 1]], coin: true },
      { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], coin: false },
    ],
    source: 'official',
    ref: 'Forgotten Forest — 룰북 5·6쪽 (시간 1, 숲, 대각선 2칸+코인 / 4칸 지그재그)',
  },
  {
    id: 'farmland',
    name: '밭갈이 들판',
    kind: 'explore',
    time: 1,
    terrains: ['farm'],
    shapes: [
      { cells: [[0, 0], [1, 0]], coin: true },
      { cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], coin: false },
    ],
    source: 'official',
    ref: 'Farmland — 룰북 8쪽 (시간 1, 농지, 2칸+코인 / 십자 5칸)',
  },

  // ---- 커스텀 카드 (원작 앞면 미확인 → 이 앱의 독자 디자인) -----------------
  {
    id: 'foothill-hamlet',
    name: '산기슭 마을',
    kind: 'explore',
    time: 1,
    terrains: ['village'],
    shapes: [
      { cells: [[0, 0], [1, 0], [1, 1]], coin: true },
      { cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]], coin: false },
    ],
    source: 'custom',
  },
  {
    id: 'silver-brook',
    name: '은빛 시내',
    kind: 'explore',
    time: 1,
    terrains: ['water'],
    shapes: [
      { cells: [[0, 0], [0, 1], [0, 2]], coin: true },
      { cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]], coin: false },
    ],
    source: 'custom',
  },
  {
    id: 'orchard-hill',
    name: '과수원 언덕',
    kind: 'explore',
    time: 2,
    terrains: ['forest', 'farm'],
    shapes: [{ cells: [[0, 0], [1, 0], [2, 0], [2, 1]], coin: false }],
    source: 'custom',
  },
  {
    id: 'treetop-lodge',
    name: '나무 위 오두막',
    kind: 'explore',
    time: 2,
    terrains: ['forest', 'village'],
    shapes: [{ cells: [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]], coin: false }],
    source: 'custom',
  },
  {
    id: 'misty-marsh',
    name: '안개 늪',
    kind: 'explore',
    time: 2,
    terrains: ['forest', 'water'],
    shapes: [{ cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], coin: false }],
    source: 'custom',
  },
  {
    id: 'mill-stream',
    name: '물레방아 개울',
    kind: 'explore',
    time: 2,
    terrains: ['farm', 'water'],
    shapes: [{ cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]], coin: false }],
    source: 'custom',
  },
  {
    id: 'dyke-farmstead',
    name: '둑길 농가',
    kind: 'explore',
    time: 2,
    terrains: ['village', 'farm'],
    shapes: [{ cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]], coin: false }],
    source: 'custom',
  },
  {
    id: 'ferry-village',
    name: '나루 마을',
    kind: 'explore',
    time: 2,
    terrains: ['village', 'water'],
    shapes: [{ cells: [[0, 0], [0, 1], [0, 2], [0, 3]], coin: false }],
    source: 'custom',
  },
];

export const AMBUSH_CARDS: AmbushCard[] = [
  {
    id: 'goblin-raid',
    name: '고블린 습격',
    cells: [[0, 0], [1, 1], [2, 2]],
    direction: 'ccw',
    soloCorner: 'br',
    source: 'official',
    ref: 'Goblin Attack — 룰북 7쪽 (대각선 3칸, 반시계, 솔로: 오른쪽 아래)',
  },
  {
    id: 'bugbear-charge',
    name: '버그베어 돌격',
    cells: [[0, 0], [1, 0], [0, 2], [1, 2]],
    direction: 'cw',
    soloCorner: 'tr',
    source: 'official',
    ref: 'Bugbear Assault — 룰북 3쪽 (2칸 두 줄 사이 한 칸 띄움, 시계, 솔로: 오른쪽 위)',
  },
  {
    id: 'shadow-imps',
    name: '그림자 도깨비 떼',
    cells: [[0, 0], [1, 0], [1, 1], [2, 0]],
    direction: 'cw',
    soloCorner: 'bl',
    source: 'custom',
  },
  {
    id: 'bog-troll',
    name: '늪지 트롤',
    cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
    direction: 'ccw',
    soloCorner: 'tl',
    source: 'custom',
  },
];

const exploreById = new Map(EXPLORE_CARDS.map((c) => [c.id, c]));
const ambushById = new Map(AMBUSH_CARDS.map((c) => [c.id, c]));

export function exploreCard(id: string): ExploreCard | undefined {
  return exploreById.get(id);
}
export function ambushCard(id: string): AmbushCard | undefined {
  return ambushById.get(id);
}
export function isAmbush(id: string): boolean {
  return ambushById.has(id);
}
export function cardName(id: string): string {
  return exploreById.get(id)?.name ?? ambushById.get(id)?.name ?? id;
}
export function cardSource(id: string): 'official' | 'custom' | undefined {
  return exploreById.get(id)?.source ?? ambushById.get(id)?.source;
}
