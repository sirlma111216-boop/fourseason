// 방 하나 = Durable Object 하나.
//
// - 방 상태는 Durable Object 내장 저장소(SQLite 기반)에 'room' 키 하나로 저장한다.
//   중요한 변화는 저장이 끝난 뒤에 확정 응답(ack)과 새 상태를 보낸다.
// - WebSocket Hibernation API(ctx.acceptWebSocket)를 쓴다. 잠들었다 깨어나도 연결은 살아 있고,
//   메모리 변수는 비어 있으므로 매번 저장소에서 다시 읽는다(load).
// - 연결별 정보(누구의 연결인가)는 소켓 attachment 에, 게임 상태는 저장소에 따로 둔다.
// - 마감·유예·정리 같은 여러 예약 작업은 방 상태의 tasks 표에 적고, alarm 하나를 가장 이른 시각에 건다.

import { DurableObject } from 'cloudflare:workers';
import {
  addHuman,
  authenticate,
  buildView,
  createRoom,
  errorText,
  handleCommand,
  nextDue,
  onConnect,
  guardRulesVersion,
  onDisconnect,
  reconcileConnections,
  runDueTasks,
  statusOf,
  type RoomEnv,
} from '../room/core';
import type { RoomState, ServerMessage } from '../room/types';
import { CONTENT_VERSION } from '../engine/game';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientMessage } from '../shared/protocol';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
  ASSETS: Fetcher;
  /** 로컬 시험 전용(운영에서는 설정하지 않는다): 게임 타이머 배율, 보관 기간 */
  TIME_SCALE?: string;
  ROOM_TTL_MS?: string;
}

interface Attachment {
  memberId: string | null;
  openedAt: number;
}

/** 만료된 방 코드를 한동안 비워 두는 기간(옛 링크가 새 방으로 이어지지 않게) */
const TOMB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const RATE = { perSecond: 8, burst: 24 };

function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export type RoomStatus = 'none' | 'expired' | 'lobby' | 'playing' | 'finished';

export class RoomDurableObject extends DurableObject<Env> {
  /** undefined = 아직 안 읽음, null = 방 없음 */
  private room: RoomState | null | undefined = undefined;
  private tomb: { expiredAt: number } | null = null;
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number; strikes: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 앱 수준 ping 은 Durable Object 를 깨우지 않고 런타임이 바로 답한다.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  private roomEnv(): RoomEnv {
    const scale = Number(this.env.TIME_SCALE);
    const ttl = Number(this.env.ROOM_TTL_MS);
    return {
      now: Date.now(),
      random: cryptoRandom,
      timeScale: scale > 0 && scale <= 1 ? scale : undefined,
      ttlMs: ttl > 0 ? ttl : undefined,
    };
  }

  private attachment(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  private async load(): Promise<RoomState | null> {
    if (this.room !== undefined) return this.room;
    const [room, tomb] = await Promise.all([
      this.ctx.storage.get<RoomState>('room'),
      this.ctx.storage.get<{ expiredAt: number }>('tomb'),
    ]);
    this.room = room ?? null;
    this.tomb = tomb ?? null;
    if (this.room) {
      // 인스턴스가 새로 떴다(배포·재시작·잠에서 깸). 살아 있는 연결로 접속 상태를 맞춘다.
      const live = new Set<string>();
      for (const ws of this.ctx.getWebSockets()) {
        const a = this.attachment(ws);
        if (a?.memberId) live.add(a.memberId);
      }
      const env = this.roomEnv();
      const changed = guardRulesVersion(this.room, CONTENT_VERSION, env);
      if (reconcileConnections(this.room, live, env) || changed) await this.persist();
    }
    return this.room;
  }

  private async persist(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room);
    await this.armAlarm();
  }

  private async armAlarm(): Promise<void> {
    if (!this.room) return;
    const due = nextDue(this.room);
    const current = await this.ctx.storage.getAlarm();
    if (due === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    const at = Math.max(due, Date.now() + 5);
    if (current !== at) await this.ctx.storage.setAlarm(at);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 이미 닫힌 소켓 */
    }
  }

  private broadcastState(except?: WebSocket): void {
    if (!this.room) return;
    const env = this.roomEnv();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = this.attachment(ws);
      if (!a?.memberId) continue;
      this.send(ws, { t: 'state', room: buildView(this.room, a.memberId, env) });
    }
  }

  /* ----------------------------------------------------------- RPC (Worker 에서 호출) */

  async init(code: string, nick: string): Promise<{ ok: true; id: string; secret: string } | { ok: false }> {
    await this.load();
    if (this.room || this.tomb) return { ok: false };
    const { state, host } = createRoom(code, nick, this.roomEnv());
    this.room = state;
    await this.persist();
    return { ok: true, id: host.id, secret: host.secret };
  }

  async status(): Promise<{ status: RoomStatus; players: number; spectators: number; expiresAt: number | null }> {
    const room = await this.load();
    if (!room) return { status: this.tomb ? 'expired' : 'none', players: 0, spectators: 0, expiresAt: null };
    const view = buildView(room, null, this.roomEnv());
    return {
      status: statusOf(room),
      players: room.seats.length,
      spectators: room.members.length - room.seats.length,
      expiresAt: view.expiresAt,
    };
  }

  /* ----------------------------------------------------------- WebSocket */

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket 연결이 필요합니다', { status: 426 });
    const room = await this.load();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ memberId: null, openedAt: Date.now() } satisfies Attachment);
    if (!room) {
      this.send(server, {
        t: 'error',
        code: this.tomb ? 'expired' : 'not-found',
        message: this.tomb ? '보관 기간이 지나 정리된 방입니다.' : '없는 방 코드입니다.',
      });
      server.close(4404, 'room not found');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    // 시험 모드(TIME_SCALE)에서는 게임이 그만큼 빨리 흐르므로 허용량도 같이 늘린다.
    const k = Math.min(10, 1 / (this.roomEnv().timeScale ?? 1));
    const burst = RATE.burst * k;
    const b = this.buckets.get(ws) ?? { tokens: burst, at: now, strikes: 0 };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * RATE.perSecond * k);
    b.at = now;
    if (b.tokens < 1) {
      b.strikes += 1;
      this.buckets.set(ws, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(ws, b);
    return true;
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) {
      this.send(ws, { t: 'error', code: 'bad-message', message: '메시지 형식이 올바르지 않습니다.' });
      return;
    }
    if (!this.allow(ws)) {
      const b = this.buckets.get(ws);
      this.send(ws, { t: 'error', code: 'rate-limit', message: '요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요.' });
      if (b && b.strikes > 40) ws.close(4008, 'rate limit');
      return;
    }
    const msg = parseClientMessage(data);
    if (!msg) {
      this.send(ws, { t: 'error', code: 'bad-message', message: '메시지 형식이 올바르지 않습니다.' });
      return;
    }
    const room = await this.load();
    if (!room) {
      this.send(ws, { t: 'error', code: 'expired', message: '보관 기간이 지나 정리된 방입니다.' });
      ws.close(4410, 'expired');
      return;
    }
    const env = this.roomEnv();
    const att = this.attachment(ws) ?? { memberId: null, openedAt: env.now };

    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) {
        this.send(ws, { t: 'error', code: 'bad-message', message: '앱이 새로 배포되었습니다. 페이지를 새로고침하세요.' });
        return;
      }
      if (att.memberId) {
        this.send(ws, { t: 'welcome', you: { id: att.memberId }, room: buildView(room, att.memberId, env) });
        return;
      }
      let m = msg.resume ? authenticate(room, msg.resume.id, msg.resume.secret) : null;
      let issued: string | undefined;
      if (!m) {
        if (msg.resume && !msg.nick) {
          this.send(ws, { t: 'error', code: 'bad-token', message: '복귀 정보가 맞지 않습니다. 닉네임으로 다시 참가하세요.' });
          return;
        }
        if (!msg.nick) {
          this.send(ws, { t: 'error', code: 'need-nick', message: '닉네임을 입력하세요.' });
          return;
        }
        const added = addHuman(room, msg.nick, env);
        if ('error' in added) {
          this.send(ws, { t: 'error', code: added.error === 'room-full' ? 'room-full' : 'need-nick', message: errorText(added.error) });
          return;
        }
        m = added;
        issued = m.secret;
      }
      // 같은 참가자의 중복 연결: 가장 새 연결만 남긴다(예전 탭에는 안내 후 닫는다).
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        if (this.attachment(other)?.memberId === m.id) {
          other.serializeAttachment({ memberId: null, openedAt: env.now } satisfies Attachment);
          this.send(other, { t: 'replaced', message: '다른 탭(기기)에서 같은 자리로 접속해 이 화면의 연결을 넘겼습니다.' });
          other.close(4001, 'replaced');
        }
      }
      ws.serializeAttachment({ memberId: m.id, openedAt: env.now } satisfies Attachment);
      onConnect(room, m.id, env);
      await this.persist();
      // 비밀 토큰은 새로 발급할 때 본인에게만 한 번 보낸다.
      this.send(ws, { t: 'welcome', you: { id: m.id, secret: issued }, room: buildView(room, m.id, env) });
      this.broadcastState(ws);
      return;
    }

    if (!att.memberId) {
      this.send(ws, { t: 'error', code: 'need-nick', message: '먼저 입장해야 합니다.' });
      return;
    }
    if (msg.t === 'sync') {
      this.send(ws, { t: 'state', room: buildView(room, att.memberId, env) });
      return;
    }
    const out = handleCommand(room, att.memberId, msg.id, msg.cmd, env);
    // 저장이 끝난 뒤에만 새 상태와 확정 응답을 보낸다. 상태를 먼저 보내 화면이 확정 응답 시점에 이미 최신이 되게 한다.
    if (out.changed) {
      await this.persist();
      this.broadcastState();
    }
    this.send(ws, { t: 'ack', id: msg.id, ok: out.ok, err: out.err ? errorText(out.err) : undefined, dup: out.dup });
    if (out.emote) {
      const data = JSON.stringify({ t: 'emote', ...out.emote } satisfies ServerMessage);
      for (const other of this.ctx.getWebSockets()) {
        if (this.attachment(other)?.memberId) {
          try {
            other.send(data);
          } catch {
            /* 닫힌 소켓 */
          }
        }
      }
    }
    if (out.removed?.length) {
      for (const other of this.ctx.getWebSockets()) {
        const a = this.attachment(other);
        if (a?.memberId && out.removed.includes(a.memberId)) {
          other.serializeAttachment({ memberId: null, openedAt: env.now } satisfies Attachment);
          this.send(other, { t: 'kicked', message: '방에서 나갔습니다.' });
          other.close(4003, 'removed');
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 닫기 요청에 답해 연결을 완전히 닫는다(자동 응답 플래그가 없는 환경에서도 안전하다).
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* 이미 닫힘 */
    }
    await this.handleGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleGone(ws);
  }

  private async handleGone(ws: WebSocket): Promise<void> {
    const a = this.attachment(ws);
    if (!a?.memberId) return;
    const room = await this.load();
    if (!room) return;
    const stillHere = this.ctx
      .getWebSockets()
      .some((o) => o !== ws && o.readyState === WebSocket.OPEN && this.attachment(o)?.memberId === a.memberId);
    if (stillHere) return;
    onDisconnect(room, a.memberId, this.roomEnv());
    await this.persist();
    this.broadcastState(ws);
  }

  /* ----------------------------------------------------------- 예약 작업 */

  async alarm(): Promise<void> {
    const room = await this.load();
    if (!room) {
      if (this.tomb && Date.now() >= this.tomb.expiredAt + TOMB_TTL_MS) {
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
        this.tomb = null;
      }
      return;
    }
    const changed = runDueTasks(room, this.roomEnv());
    if (room.expired) {
      await this.wipe();
      return;
    }
    if (changed) {
      await this.persist();
      this.broadcastState();
    } else {
      await this.armAlarm();
    }
  }

  /** 보관 기간이 지난 방을 지운다. 코드만 잠시 비석(tomb)으로 남긴다. */
  private async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: 'error', code: 'expired', message: '보관 기간이 지나 방을 정리했습니다.' });
      try {
        ws.close(4410, 'expired');
      } catch {
        /* 이미 닫힘 */
      }
    }
    const now = Date.now();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('tomb', { expiredAt: now });
    await this.ctx.storage.setAlarm(now + TOMB_TTL_MS);
    this.room = null;
    this.tomb = { expiredAt: now };
  }
}
