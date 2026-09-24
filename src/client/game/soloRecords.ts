// 솔로 도전 기록: 이 기기에만 저장한다(전체 공개 순위표는 없다).
// 기록은 규칙 버전·지도 면·모드·목표 구성이 같은 것끼리 비교한다.

import { load, save } from '../storage';

export interface SoloRecord {
  at: number;
  gameKey: string;
  score: number;
  rules: string;
  mapSide: string;
  mode: string;
  objectives: string[];
}

const KEY = 'soloRecords.v1';

export function configKey(r: Pick<SoloRecord, 'rules' | 'mapSide' | 'mode' | 'objectives'>): string {
  return `${r.rules}|${r.mapSide}|${r.mode}|${[...r.objectives].join(',')}`;
}

export function allRecords(): SoloRecord[] {
  return load<SoloRecord[]>(KEY, []);
}

/** 같은 게임을 두 번 저장하지 않는다 */
export function addRecord(r: SoloRecord): SoloRecord[] {
  const list = allRecords();
  if (!list.some((x) => x.gameKey === r.gameKey)) {
    list.push(r);
    save(KEY, list.slice(-200));
  }
  return allRecords();
}

/**
 * 커스텀 칭호. 원작 솔로 등급표는 목표 카드별 보정치가 필요한데 그 값을 공식 자료에서
 * 확인하지 못해 적용하지 않는다. 아래 기준은 이 앱의 중급 봇 솔로 기록(평균 약 110점)으로 정했다.
 */
export const CUSTOM_TITLES: { min: number; title: string }[] = [
  { min: 130, title: '전설의 지도사' },
  { min: 110, title: '왕실 지도 장인' },
  { min: 90, title: '숙련 측량사' },
  { min: 70, title: '견습 측량사' },
  { min: 50, title: '새내기 지도사' },
  { min: -Infinity, title: '지도 그리기 연습생' },
];

export function customTitle(score: number): string {
  return CUSTOM_TITLES.find((t) => score >= t.min)!.title;
}
