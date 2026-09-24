// 아주 작은 주소 라우터(History API). /r/ABC123 을 새로고침해도 Worker 의 SPA 폴백이 index.html 을 준다.

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => listeners.forEach((l) => l()));
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}
