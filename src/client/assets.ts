// 그래픽 에셋 연결표.
// public/assets/terrain/<이름>.webp (또는 .png) 가 있으면 그 그림을, 없으면 코드로 그린 SVG 아이콘을 쓴다.
// 격자·미리보기·판정은 모두 좌표 데이터로 하므로 그림이 없어도 게임은 그대로 돈다.

import { useSyncExternalStore } from 'react';

export type AssetKey = 'forest' | 'village' | 'farm' | 'water' | 'monster' | 'mountain' | 'ruins';

const KEYS: AssetKey[] = ['forest', 'village', 'farm', 'water', 'monster', 'mountain', 'ruins'];

export const BACKGROUNDS = {
  title: '/assets/backgrounds/title.webp',
  titleSmall: '/assets/backgrounds/title-small.webp',
  lobby: '/assets/backgrounds/lobby-background.webp',
  parchment: '/assets/backgrounds/parchment.webp',
};

const resolved: Partial<Record<AssetKey, string | null>> = {};
const listeners = new Set<() => void>();
let version = 0;

function tryLoad(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

let started = false;
/** 앱 시작 시 한 번: 지형 그림을 미리 불러 보고, 없는 것은 SVG 로 대체한다. */
export function preloadAssets(): void {
  if (started) return;
  started = true;
  for (const key of KEYS) {
    void (async () => {
      for (const ext of ['webp', 'png']) {
        const url = `/assets/terrain/${key}.${ext}`;
        if (await tryLoad(url)) {
          resolved[key] = url;
          version++;
          listeners.forEach((l) => l());
          return;
        }
      }
      resolved[key] = null;
      version++;
      listeners.forEach((l) => l());
    })();
  }
}

export function assetUrl(key: AssetKey): string | null {
  return resolved[key] ?? null;
}

/** 에셋 로딩 상태가 바뀌면 다시 그린다 */
export function useAssets(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}
