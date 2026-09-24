// 목표 16장의 득점 예시와 예외. 지도는 A면(산 B4 C9 F6 I3 J8, 폐허 B6 C2 C10 I2 I10 J6).
import { describe, expect, it } from 'vitest';
import { MAPS, objective, ruinsMask } from '../../src/engine';
import { at, boardFrom } from './helpers';

const ruinsA = ruinsMask(MAPS.A);
const score = (id: string, rows: string[]) => objective(id).score({ board: boardFrom(rows), ruins: ruinsA });

describe('숲', () => {
  it('가장자리 숲: 테두리 줄의 숲만', () => {
    const r = score('edge-forest', ['F....F.....', '...........', '...........', '...........', '...........', 'F....F.....', '...........', '...........', '...........', '...........', '..........F']);
    expect(r.points).toBe(4); // (0,0) (0,5) (5,0) (10,10) — (5,5)는 산이라 숲이 아님
  });
  it('깊은 숲: 사방이 채워졌거나 지도 가장자리', () => {
    const r = score('deep-forest', ['FV.........', 'V..........', '.....V.....', '....VFV....', '...........']);
    // (0,0): 위·왼쪽은 가장자리, 오른쪽 V, 아래 V → 1점. (3,5): 아래(4,5) 빈칸 → 0점
    expect(r.points).toBe(1);
    expect(r.cells).toEqual([at(0, 0)]);
  });
  it('초록 줄무늬: 숲이 있는 행 수 + 열 수', () => {
    const r = score('green-lines', ['F..F.......', '...........', '...F.......']);
    expect(r.points).toBe(4); // 행 {0,2}, 열 {0,3}
  });
  it('산등성이 숲길: 숲 무리 하나로 이어진 산마다 3점', () => {
    // B4(1,3) 과 C9(2,8) 을 숲 무리로 잇는다: (1,4)~(1,7),(2,7)
    const r = score('ridge-forest', ['...........', '....FFFF...', '.......F...', '...........', '...........', '....F......']);
    expect(r.points).toBe(6);
    // F6(5,5) 에만 닿은 숲 (5,4) 는 다른 산과 이어지지 않아 0점
  });
  it('산등성이 숲길: 산 하나에만 닿은 무리는 0점', () => {
    expect(score('ridge-forest', ['...........', '....F......']).points).toBe(0);
  });
});

describe('농지·물', () => {
  it('물길 논밭: 농지 옆 물 + 물 옆 농지', () => {
    const r = score('irrigation', ['WAA........']);
    expect(r.points).toBe(2); // 물(0,0) 1 + 농지(0,1) 1, 농지(0,2)는 물과 닿지 않음
  });
  it('폐허 곡창: 폐허 옆 물 1점, 폐허 위 농지 3점, 폐허 위 물은 옆에 폐허가 없으면 0점', () => {
    // B6(1,5) 폐허 위 농지, (1,4) 물은 B6 옆. C2(2,1) 폐허 위의 물(2,1)은 주변에 폐허가 없다.
    const r = score('ruin-granary', ['...........', '....WA.....', '.W.........']);
    expect(r.points).toBe(1 + 3);
  });
  it('산골짜기: 산 옆 물 2점, 산 옆 농지 1점', () => {
    const r = score('mountain-valley', ['...A.......', '..W........']);
    expect(r.points).toBe(3); // 물(1,2)–B4, 농지(0,3)–B4
  });
  it('내륙의 들과 호수: 가장자리·상대 지형에 닿지 않은 무리', () => {
    const r = score('inland', [
      '...........',
      '...........',
      '...........',
      '..AA.......', // 농지 무리: 가장자리·물 X → 3점
      '...........',
      '.......WW..', // 물 무리: 3점
      '...........',
      'W..........', // 가장자리 물 → 0점
      '..........A', // 가장자리 농지 → 0점
      '.....AW....', // 붙어 있는 농지·물 → 둘 다 0점
    ]);
    expect(r.points).toBe(6);
  });
});

describe('마을', () => {
  it('큰 마을: 6칸 이상 무리마다 8점', () => {
    expect(score('big-towns', ['VVVVVV.....']).points).toBe(8);
    expect(score('big-towns', ['VVVVV......']).points).toBe(0);
  });
  it('교차로 마을: 서로 다른 지형 3종 이상과 닿은 무리', () => {
    // (0,5)(0,6) 마을: 숲(0,4), 농지(0,7), 물(1,5) → 3종
    expect(score('crossroads', ['....FVVA...', '.....W.....']).points).toBe(3);
    // 산도 지형으로 센다: 마을 (0,3) 은 산 B4(1,3), 숲, 농지와 닿음
    expect(score('crossroads', ['..FVA......']).points).toBe(3);
    expect(score('crossroads', ['....FVV....', '.....W.....']).points).toBe(0);
  });
  it('수도: 산과 닿지 않은 가장 큰 무리의 칸 수', () => {
    // 무리1: (0,2)(0,3)(0,4) — (0,3)이 산 B4 와 닿음 → 제외. 무리2: (4,0)~(4,3) 4칸
    const r = score('capital', ['..VVV......', '...........', '...........', '...........', 'VVVV.......']);
    expect(r.points).toBe(4);
  });
  it('둘째 도시: 두 번째로 큰 무리 × 2, 가장 큰 무리가 둘이면 그 크기', () => {
    expect(score('second-city', ['VVVVV.VVVVV', '...........', 'VV.........']).points).toBe(10);
    expect(score('second-city', ['VVVVV.VVV..']).points).toBe(6);
    expect(score('second-city', ['VVVVV......']).points).toBe(0);
  });
});

describe('땅의 모양', () => {
  it('가득 찬 줄: 산도 채워진 칸이다', () => {
    const r = score('full-lines', ['FFFFFFFFFFF', 'FFF.FFFFFFF']); // 1행의 (1,3)은 산 B4
    expect(r.points).toBe(12);
  });
  it('옛 대각선 길: 왼쪽 아래 모서리 한 칸짜리 대각선도 센다', () => {
    const rows = Array.from({ length: 11 }, () => '...........');
    rows[10] = 'F..........';
    expect(score('old-road', rows).points).toBe(3);
    // 주 대각선(0,0)~(10,10): F6(5,5)는 산이라 이미 채워져 있다
    const diag = Array.from({ length: 11 }, (_, r) => '...........'.split('').map((c, i) => (i === r && r !== 5 ? 'F' : c)).join(''));
    expect(score('old-road', diag).points).toBe(3);
  });
  it('네모난 영지: 가장 큰 채워진 정사각형의 한 변 × 3', () => {
    expect(score('square-domain', ['FFF........', 'FFF........', 'FFF........']).points).toBe(9);
    expect(score('square-domain', ['...........']).points).toBe(3); // 산 한 칸도 1x1 정사각형
  });
  it('움푹한 빈터: 사방이 채워졌거나 가장자리인 빈칸', () => {
    const r = score('hollows', ['.F.........', 'F..........']);
    expect(r.points).toBe(1);
    expect(r.cells).toEqual([at(0, 0)]);
  });
});
