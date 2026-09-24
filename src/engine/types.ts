// 규칙 엔진 공용 타입.
// 이 폴더(src/engine)는 브라우저·Worker 어디서도 돌아가는 순수 함수만 둔다.
// DOM, Cloudflare API, Date.now() 를 직접 부르지 않는다(시각은 인자로 받는다).

/** 지도 한 변의 칸 수 (공식 지도지: 11 x 11, 행 A~K / 열 1~11) */
export const N = 11;
export const CELL_COUNT = N * N;

export type Terrain = 'forest' | 'village' | 'farm' | 'water' | 'monster' | 'mountain';
/** 플레이어가 직접 그릴 수 있는 지형(산은 지도에 인쇄되어 있을 뿐 그릴 수 없다) */
export type DrawTerrain = Exclude<Terrain, 'mountain'>;

export type Coord = readonly [number, number];
export type ShapeCells = readonly Coord[];

/**
 * 보드는 121글자 문자열로 저장한다(저장·전송이 가볍고 비교가 쉽다).
 *  .  빈칸      F 숲      V 마을     A 농지(Agriculture)
 *  W  물        M 몬스터  X 산        # 황무지(채워진 칸으로 취급)
 * 폐허는 지도 정의(MapDef.ruins)에 따로 있고, 폐허 위에도 지형을 그릴 수 있다.
 */
export type BoardString = string;

export const TERRAIN_CHAR: Record<Terrain, string> = {
  forest: 'F',
  village: 'V',
  farm: 'A',
  water: 'W',
  monster: 'M',
  mountain: 'X',
};
export const EMPTY = '.';
export const WASTE = '#';

export const CHAR_TERRAIN: Record<string, Terrain | undefined> = {
  F: 'forest',
  V: 'village',
  A: 'farm',
  W: 'water',
  M: 'monster',
  X: 'mountain',
};

export const DRAW_TERRAINS: DrawTerrain[] = ['forest', 'village', 'farm', 'water', 'monster'];

/** 데이터 출처 표시. 공식 자료에서 직접 확인한 것과 이 앱이 새로 만든 것을 섞지 않는다. */
export type DataSource = 'official' | 'custom';

export type Placement =
  | { kind: 'shape'; shape: number; terrain: DrawTerrain; t: number; row: number; col: number }
  | { kind: 'single'; terrain: DrawTerrain; row: number; col: number }
  | { kind: 'pass' };

export type SubmitBy = 'self' | 'timeout' | 'proxy' | 'solo';

export interface Submission {
  placement: Placement;
  cells: number[];
  terrain: DrawTerrain | null;
  coin: boolean;
  by: SubmitBy;
  at: number;
}

export interface Turn {
  /** 게임 안에서 유일한 턴 번호(명령의 turnId 로 쓰인다) */
  id: number;
  season: number;
  kind: 'draw' | 'ambush';
  /** 이번 턴에 그릴 탐험 카드 또는 매복 카드 id */
  card: string;
  /** 폐허 효과가 걸린 그리기 턴인가 */
  ruins: boolean;
  /** 이번 턴에 공개된 카드들(폐허 → 폐허 → 탐험처럼 여러 장일 수 있다) */
  revealed: string[];
  /** targets[seat] = 이 자리가 그림을 그릴 지도의 주인 자리. 그리기 턴이면 자기 자신. */
  targets: number[];
  /** 자리별 제출. 모두 차면 턴이 해결된다. */
  subs: (Submission | null)[];
  startedAt: number;
}

export interface PlacementLog {
  turn: number;
  season: number;
  cells: number[];
  terrain: DrawTerrain;
  /** 누가 그렸는가(자리 번호). 매복이면 이웃 자리, 솔로 매복이면 -1 */
  by: number;
  kind: 'draw' | 'fallback' | 'ambush' | 'solo-ambush';
  card: string;
  coin: boolean;
  auto: SubmitBy;
}

export interface SeasonScore {
  season: number;
  /** 이번 계절에 평가한 목표 슬롯 (0=A,1=B,2=C,3=D) */
  edicts: [number, number];
  points: [number, number];
  coins: number;
  /** 몬스터 옆 빈칸 수(벌점). 합계에서는 뺀다. */
  monsters: number;
  total: number;
}

export interface PlayerState {
  board: BoardString;
  coins: number;
  /** 산 포위 보상을 이미 받은 산 칸 번호(같은 산으로 두 번 받지 않는다) */
  mountainCoins: number[];
  seasons: SeasonScore[];
  log: PlacementLog[];
}

export type GameMode = 'standard' | 'quick';
export type MapSide = 'A' | 'B';

export type GameEvent =
  | { type: 'ambush'; turn: number; card: string; targets: number[] }
  | { type: 'solo-ambush'; turn: number; card: string; cells: number[] | null }
  | { type: 'auto'; turn: number; seat: number; by: SubmitBy }
  | { type: 'coin'; turn: number; seat: number; count: number; reason: 'shape' | 'mountain' }
  | { type: 'season-end'; season: number }
  | { type: 'ruins'; turn: number }
  | { type: 'deck-empty'; season: number };

export interface GameState {
  rules: string;
  seed: number;
  rng: number;
  mapSide: MapSide;
  mode: GameMode;
  solo: boolean;
  seatCount: number;
  /** A, B, C, D 슬롯에 놓인 목표 카드 id */
  objectives: [string, string, string, string];
  season: number;
  /** 비공개 탐험 덱. 끝이 맨 위. 클라이언트로 절대 보내지 않는다. */
  deck: string[];
  /** 비공개 매복 덱 */
  ambushDeck: string[];
  /** 해결되어 게임에서 빠진 매복 카드 */
  removed: string[];
  /** 이번 계절에 공개된 탐험 카드 기둥(시간 합산 대상) */
  column: string[];
  /** 폐허가 공개되었고 아직 다음 탐험 카드에 적용되지 않았는가 */
  pendingRuins: boolean;
  turnSeq: number;
  turn: Turn | null;
  phase: 'draw' | 'ambush' | 'seasonEnd' | 'gameOver';
  players: PlayerState[];
  /** 최근 사건(화면 안내용). 오래된 것은 잘라낸다. */
  events: GameEvent[];
}
