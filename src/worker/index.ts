// Cloudflare Worker 진입점.
//   /api/*  → 방 만들기·방 상태 (JSON)
//   /ws/:code → 그 방의 Durable Object 로 WebSocket 을 넘긴다
//   그 밖   → 정적 화면(Workers Static Assets, SPA 폴백은 wrangler.jsonc 설정)
// API·WebSocket 요청에는 절대 index.html 을 돌려주지 않는다.

import { CONTENT_VERSION } from '../engine/game';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, cleanNick, isRoomCode, normalizeCode } from '../shared/protocol';
import { RoomDurableObject, type Env } from './room-do';

export { RoomDurableObject };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function makeCode(): string {
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  let s = '';
  for (const n of buf) s += ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length];
  return s;
}

const isLocalHost = (host: string): boolean => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/** 브라우저가 보낸 Origin 이 이 사이트인지(다른 사이트에서 몰래 붙는 것을 막는다) */
function originAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // 브라우저가 아닌 클라이언트(테스트 스크립트 등)
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.host === url.host) return true;
  return isLocalHost(url.host) && isLocalHost(o.host); // 로컬 개발(Vite 프록시)
}

const stub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      if (path === '/api/health') return json({ ok: true, rules: CONTENT_VERSION });

      if (path === '/api/rooms' && request.method === 'POST') {
        if (!originAllowed(request, url)) return json({ error: '허용되지 않은 출처입니다.' }, 403);
        const text = await request.text();
        if (text.length > 1024) return json({ error: '요청이 너무 큽니다.' }, 413);
        let body: { nick?: unknown } = {};
        try {
          body = JSON.parse(text || '{}');
        } catch {
          return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
        }
        const nick = cleanNick(body.nick);
        if (!nick) return json({ error: '닉네임을 입력하세요.' }, 400);
        // 코드가 이미 쓰이고 있으면 새로 뽑는다.
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = makeCode();
          const res = await stub(env, code).init(code, nick);
          if (res.ok) return json({ code, id: res.id, secret: res.secret });
        }
        return json({ error: '방 코드를 만들지 못했습니다. 다시 시도하세요.' }, 503);
      }

      const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
      if (m && request.method === 'GET') {
        const code = normalizeCode(m[1]);
        if (!isRoomCode(code)) return json({ status: 'none' }, 404);
        return json(await stub(env, code).status());
      }
      return json({ error: '없는 API 입니다.' }, 404);
    }

    if (path.startsWith('/ws/')) {
      const code = normalizeCode(path.slice(4));
      if (!isRoomCode(code)) return json({ error: '방 코드가 올바르지 않습니다.' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket 연결이 필요합니다.' }, 426);
      if (!originAllowed(request, url)) return json({ error: '허용되지 않은 출처입니다.' }, 403);
      return stub(env, code).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
