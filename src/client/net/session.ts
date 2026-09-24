// 화면이 쓰는 "방 연결" 하나.
//  - OnlineSession: 실제 방 서버(Durable Object)에 WebSocket 으로 붙는다. 끊기면 다시 붙고 전체 상태를 다시 받는다.
//  - LocalSession: 혼자 하기·봇 대전. 같은 방 규칙(src/room/core)을 브라우저 안에서 돌린다.
// 두 경우 모두 화면은 똑같은 RoomView 를 받고, 똑같은 명령(Command)을 보낸다.

import { CONTENT_VERSION } from '../../engine/game';
import type { BotLevel } from '../../engine/bot';
import {
  buildView,
  createRoom,
  errorText,
  handleCommand,
  nextDue,
  onConnect,
  runDueTasks,
  type RoomEnv,
} from '../../room/core';
import type { RoomState, RoomView, ServerMessage } from '../../room/types';
import { PROTOCOL_VERSION, type Command, type RoomSettings } from '../../shared/protocol';
import { creds, load, profile, remove, save } from '../storage';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EmoteEvent {
  uid: string;
  from: string;
  key: string;
  at: number;
}

export interface Snapshot {
  kind: 'online' | 'local';
  code: string;
  conn: ConnState;
  room: RoomView | null;
  youId: string | null;
  /** 끝난 연결의 이유(만료·없음·다른 탭 등) */
  fatal: { code: string; message: string } | null;
  needNick: boolean;
  toast: { id: number; text: string; tone: 'info' | 'warn' | 'error' } | null;
  emotes: EmoteEvent[];
  /** 서버 시각 - 내 시각 (타이머 표시용) */
  clockSkew: number;
  pendingCount: number;
}

export interface CommandResult {
  ok: boolean;
  err?: string;
}

export interface Session {
  subscribe(cb: () => void): () => void;
  getSnapshot(): Snapshot;
  send(cmd: Command): Promise<CommandResult>;
  join?(nick: string): void;
  dispose(): void;
}

export function commandId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

abstract class Base implements Session {
  protected snap: Snapshot;
  private listeners = new Set<() => void>();
  private toastSeq = 0;

  constructor(kind: 'online' | 'local', code: string) {
    this.snap = {
      kind,
      code,
      conn: 'connecting',
      room: null,
      youId: null,
      fatal: null,
      needNick: false,
      toast: null,
      emotes: [],
      clockSkew: 0,
      pendingCount: 0,
    };
  }
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getSnapshot = () => this.snap;
  protected patch(p: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }
  protected toast(text: string, tone: 'info' | 'warn' | 'error' = 'info') {
    this.patch({ toast: { id: ++this.toastSeq, text, tone } });
  }
  protected pushEmote(e: { from: string; key: string }) {
    // 말풍선 표시 시간은 이 기기 시계로 잰다
    const list = [...this.snap.emotes, { from: e.from, key: e.key, at: Date.now(), uid: commandId() }].slice(-12);
    this.patch({ emotes: list });
  }
  abstract send(cmd: Command): Promise<CommandResult>;
  abstract dispose(): void;
}

/* ------------------------------------------------------------------ 온라인 */

export class OnlineSession extends Base {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = Date.now();
  private terminal = false;
  private disposed = false;
  private pending = new Map<string, { cmd: Command; resolve: (r: CommandResult) => void }>();
  private onVisible = () => {
    if (document.visibilityState === 'visible' && !this.terminal && (!this.ws || this.ws.readyState > 1)) this.connectNow();
  };
  private onOnline = () => this.connectNow();

  constructor(code: string) {
    super('online', code);
    this.connect();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > 50_000) {
        // 응답이 너무 오래 없다 → 다시 연결
        this.ws.close();
        return;
      }
      try {
        this.ws.send('{"t":"ping"}');
      } catch {
        /* 무시 */
      }
    }, 20_000);
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws/${this.snap.code}`;
  }

  private connectNow() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    this.connect();
  }

  private connect() {
    if (this.disposed || this.terminal) return;
    if (this.ws && this.ws.readyState <= 1) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.lastMessageAt = Date.now();
      this.sendHello();
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      if (typeof ev.data !== 'string') return;
      let msg: ServerMessage | { t: 'pong' };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.disposed || this.terminal) {
        this.patch({ conn: 'closed' });
        return;
      }
      this.patch({ conn: 'reconnecting' });
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose 가 이어서 온다 */
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disposed || this.terminal) return;
    const base = Math.min(8000, 500 * 2 ** this.attempts);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, base + Math.random() * 400);
  }

  private sendHello() {
    const c = creds.get(this.snap.code);
    this.raw({ t: 'hello', v: PROTOCOL_VERSION, nick: profile.nick(), resume: c ? { id: c.id, secret: c.secret } : null });
  }

  private raw(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** 닉네임을 정하고 입장(처음 온 사람) */
  join(nick: string) {
    profile.setNick(nick);
    this.patch({ needNick: false });
    this.sendHello();
  }

  private onMessage(msg: ServerMessage | { t: 'pong' }) {
    switch (msg.t) {
      case 'pong':
        return;
      case 'welcome': {
        if (msg.you.secret) creds.set(this.snap.code, msg.you.id, msg.you.secret);
        this.patch({
          conn: 'open',
          youId: msg.you.id,
          room: msg.room,
          needNick: false,
          clockSkew: msg.room.serverNow - Date.now(),
        });
        this.attempts = 0;
        // 끊겨 있는 동안 보내지 못한(또는 응답을 못 받은) 명령을 같은 id 로 다시 보낸다(서버가 중복을 거른다).
        for (const [id, p] of this.pending) this.raw({ t: 'cmd', id, cmd: p.cmd });
        return;
      }
      case 'state': {
        const cur = this.snap.room;
        if (cur && msg.room.revision < cur.revision) return;
        this.patch({ room: msg.room, clockSkew: msg.room.serverNow - Date.now() });
        return;
      }
      case 'ack': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          this.patch({ pendingCount: this.pending.size });
          p.resolve({ ok: msg.ok, err: msg.err });
        }
        return;
      }
      case 'emote':
        this.pushEmote(msg);
        return;
      case 'replaced':
        this.terminal = true;
        this.patch({ fatal: { code: 'replaced', message: msg.message }, conn: 'closed' });
        return;
      case 'kicked':
        this.terminal = true;
        creds.clear(this.snap.code);
        this.patch({ fatal: { code: 'kicked', message: msg.message }, conn: 'closed' });
        return;
      case 'error': {
        if (msg.code === 'need-nick') {
          this.patch({ needNick: true, conn: 'open' });
          return;
        }
        if (msg.code === 'bad-token') {
          creds.clear(this.snap.code);
          this.patch({ needNick: true, conn: 'open' });
          this.toast(msg.message, 'warn');
          return;
        }
        if (msg.code === 'expired' || msg.code === 'not-found' || msg.code === 'room-full') {
          this.terminal = true;
          if (msg.code !== 'room-full') creds.clear(this.snap.code);
          this.patch({ fatal: { code: msg.code, message: msg.message }, conn: 'closed' });
          return;
        }
        this.toast(msg.message, msg.code === 'rate-limit' ? 'warn' : 'error');
        return;
      }
    }
  }

  send(cmd: Command): Promise<CommandResult> {
    const id = commandId();
    return new Promise((resolve) => {
      this.pending.set(id, { cmd, resolve });
      this.patch({ pendingCount: this.pending.size });
      this.raw({ t: 'cmd', id, cmd });
      // 연결이 없으면 다시 붙은 뒤 welcome 에서 자동으로 다시 보낸다.
    });
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    try {
      this.ws?.close(1000, 'bye');
    } catch {
      /* 무시 */
    }
    this.ws = null;
  }
}

/* ------------------------------------------------------------------ 로컬(혼자 하기) */

const LOCAL_KEY = 'local.v1';

interface LocalSave {
  state: RoomState;
  humanId: string;
}

function localEnv(): RoomEnv {
  return {
    now: Date.now(),
    random: () => {
      const b = new Uint32Array(1);
      crypto.getRandomValues(b);
      return b[0] / 4294967296;
    },
  };
}

export interface LocalGameOptions {
  nick: string;
  bots: BotLevel[];
  settings: Partial<RoomSettings>;
}

export function hasLocalGame(): boolean {
  const s = load<LocalSave | null>(LOCAL_KEY, null);
  return !!s && !!s.state?.game && s.state.game.phase !== 'gameOver' && s.state.game.rules === CONTENT_VERSION;
}

export function clearLocalGame(): void {
  remove(LOCAL_KEY);
}

export class LocalSession extends Base {
  private state: RoomState;
  private humanId: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private constructor(state: RoomState, humanId: string) {
    super('local', 'LOCAL');
    this.state = state;
    this.humanId = humanId;
    onConnect(this.state, this.humanId, localEnv());
    this.persist();
    this.emit();
    this.schedule();
  }

  static create(opts: LocalGameOptions): LocalSession {
    const env = localEnv();
    const { state, host } = createRoom('LOCAL', opts.nick, env, {
      local: true,
      settings: { turnSeconds: 0, ...opts.settings },
    });
    for (const level of opts.bots) handleCommand(state, host.id, commandId(), { a: 'addBot', level }, env);
    onConnect(state, host.id, env);
    handleCommand(state, host.id, commandId(), { a: 'start' }, env);
    return new LocalSession(state, host.id);
  }

  /** 저장된 혼자 하기 게임을 이어서. 규칙 버전이 바뀌었으면 이어 가지 않는다. */
  static resume(): LocalSession | null {
    const s = load<LocalSave | null>(LOCAL_KEY, null);
    if (!s || !s.state?.game) return null;
    if (s.state.game.rules !== CONTENT_VERSION) {
      clearLocalGame();
      return null;
    }
    return new LocalSession(s.state, s.humanId);
  }

  private persist() {
    save(LOCAL_KEY, { state: this.state, humanId: this.humanId } satisfies LocalSave);
  }

  private emit() {
    const env = localEnv();
    this.patch({
      conn: 'open',
      youId: this.humanId,
      room: buildView(this.state, this.humanId, env),
      clockSkew: 0,
    });
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed) return;
    const due = nextDue(this.state);
    if (due === null) return;
    this.timer = setTimeout(() => this.tick(), Math.max(0, due - Date.now()));
  }

  private tick() {
    this.timer = null;
    if (this.disposed) return;
    if (runDueTasks(this.state, localEnv())) {
      this.persist();
      this.emit();
    }
    this.schedule();
  }

  send(cmd: Command): Promise<CommandResult> {
    const out = handleCommand(this.state, this.humanId, commandId(), cmd, localEnv());
    if (out.emote) this.pushEmote(out.emote);
    if (out.changed) {
      this.persist();
      this.emit();
      this.schedule();
    }
    return Promise.resolve({ ok: out.ok, err: out.err ? errorText(out.err) : undefined });
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
