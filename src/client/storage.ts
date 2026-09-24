// 이 기기에만 남는 값(localStorage). 사생활 보호 모드 등에서 실패해도 앱은 그대로 돈다.

const PREFIX = 'sgjd.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 저장 불가(용량·사생활 모드) — 무시 */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 무시 */
  }
}

export interface RoomCreds {
  id: string;
  secret: string;
  savedAt: number;
}

/** 방별 복귀 정보. 비밀 토큰은 URL 에 넣지 않고 이 기기에만 둔다. */
export const creds = {
  get(code: string): RoomCreds | null {
    return load<RoomCreds | null>('room.' + code, null);
  },
  set(code: string, id: string, secret: string): void {
    save('room.' + code, { id, secret, savedAt: Date.now() });
    const recent = load<string[]>('recentRooms', []).filter((c) => c !== code);
    recent.unshift(code);
    save('recentRooms', recent.slice(0, 5));
  },
  clear(code: string): void {
    remove('room.' + code);
    save(
      'recentRooms',
      load<string[]>('recentRooms', []).filter((c) => c !== code),
    );
  },
  recent(): string[] {
    return load<string[]>('recentRooms', []);
  },
};

export const profile = {
  nick(): string {
    return load<string>('nick', '');
  },
  setNick(n: string): void {
    save('nick', n);
  },
  tutorialDone(): boolean {
    return load<boolean>('tutorialDone', false);
  },
  setTutorialDone(): void {
    save('tutorialDone', true);
  },
};
