// 시험용 WebSocket 클라이언트: 실제 로컬 Worker(wrangler dev)에 실제 프로토콜로 붙는다.
import { chooseBotPlacement } from '../../src/engine/bot';
import type { RoomView } from '../../src/room/types';
import { engineState } from '../../src/room/view-state';
import type { Command } from '../../src/shared/protocol';

export interface Ack {
  t: 'ack';
  id: string;
  ok: boolean;
  err?: string;
  dup?: boolean;
}

let seq = 0;
export const rid = () => 't' + Date.now().toString(36) + (++seq).toString(36);

export class TestClient {
  ws: WebSocket | null = null;
  room: RoomView | null = null;
  id = '';
  secret = '';
  errors: { code: string; message: string }[] = [];
  closedCode: number | null = null;
  messages: string[] = [];
  sentLog: string[] = [];
  private pending = new Map<string, (a: Ack) => void>();
  /** 실제 화면처럼: 한 턴에 한 번만 확정 버튼을 누른다 */
  private submittedKey = '';
  private readyKey = '';
  private waiters: { pred: () => boolean; resolve: () => void }[] = [];

  constructor(
    public base: string,
    public code: string,
    public nick: string,
  ) {}

  get seat(): number {
    return this.room?.you?.seat ?? -1;
  }

  async connect(resume?: { id: string; secret: string } | null, opts: { expectError?: boolean } = {}): Promise<void> {
    this.room = null;
    this.closedCode = null;
    const ws = new WebSocket(this.base.replace(/^http/, 'ws') + '/ws/' + this.code);
    this.ws = ws;
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('ws error'));
    });
    ws.onmessage = (ev) => this.onMsg(String(ev.data));
    ws.onclose = (ev) => {
      this.closedCode = ev.code;
      this.check();
    };
    const r = resume === undefined ? (this.secret ? { id: this.id, secret: this.secret } : null) : resume;
    ws.send(JSON.stringify({ t: 'hello', v: 1, nick: this.nick, resume: r }));
    if (opts.expectError) {
      await this.waitFor(() => this.errors.length > 0 || this.closedCode !== null, 10000);
      return;
    }
    await this.waitFor(() => !!this.room, 15000, 'welcome');
  }

  private onMsg(raw: string) {
    this.messages.push(raw);
    if (this.messages.length > 200) this.messages.shift();
    const m = JSON.parse(raw);
    if (m.t === 'welcome') {
      this.id = m.you.id;
      if (m.you.secret) this.secret = m.you.secret;
      this.room = m.room;
    } else if (m.t === 'state') {
      if (!this.room || m.room.revision >= this.room.revision) this.room = m.room;
    } else if (m.t === 'ack') {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      p?.(m);
    } else if (m.t === 'error') {
      this.errors.push({ code: m.code, message: m.message });
    }
    this.check();
  }

  private check() {
    for (const w of [...this.waiters]) {
      let ok = false;
      try {
        ok = w.pred();
      } catch {
        ok = false;
      }
      if (ok) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }

  waitFor(pred: () => boolean, timeoutMs = 20000, label = 'condition'): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = {
        pred,
        resolve: () => {
          clearTimeout(t);
          resolve();
        },
      };
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`timeout waiting for ${label} (${this.nick})`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  send(cmd: Command, id = rid()): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ack timeout ' + JSON.stringify(cmd) + ' closed=' + this.closedCode + ' ready=' + this.ws?.readyState + ' sent=' + this.sentLog.length + ' ' + this.sentLog.slice(-12).join(',') + ' errors=' + JSON.stringify(this.errors.slice(-3)) + ' last=' + this.messages.slice(-2).map((m) => m.slice(0, 300)).join(' | '))), 20000);
      this.pending.set(id, (a) => {
        clearTimeout(t);
        resolve(a);
      });
      this.sentLog.push(Date.now() % 100000 + ':' + cmd.a);
      this.ws!.send(JSON.stringify({ t: 'cmd', id, cmd }));
    });
  }

  sendRaw(text: string) {
    this.ws!.send(text);
  }

  /** 지금 내 차례가 있으면 합법 배치 하나를 골라 제출(실제 클라이언트와 같은 명령) */
  async playTurn(): Promise<Ack | null> {
    const g = this.room?.game;
    const seat = this.seat;
    if (!g || !g.turn || seat < 0 || g.turn.submitted[seat]) return null;
    const key = g.no + ':' + g.turn.id;
    if (this.submittedKey === key) return null;
    this.submittedKey = key;
    const st = engineState(g);
    const choice = chooseBotPlacement(st, seat, 'easy', g.turn.id * 31 + seat);
    return this.send({ a: 'place', turnId: g.turn.id, placement: choice.placement, target: g.turn.targets[seat] });
  }

  /** 계절 채점 뒤 준비 완료(한 번만) */
  async seasonReady(): Promise<Ack | null> {
    const g = this.room?.game;
    if (!g || g.phase !== 'seasonEnd' || g.seasonReady.includes(this.id)) return null;
    const key = g.no + ':' + g.season;
    if (this.readyKey === key) return null;
    this.readyKey = key;
    return this.send({ a: 'seasonReady', season: g.season });
  }

  close() {
    try {
      this.ws?.close(1000, 'bye');
    } catch {
      /* 무시 */
    }
  }
}

/** 여러 사람 클라이언트가 게임 끝까지 두게 한다 */
export async function playToEnd(clients: TestClient[], opts: { concurrent?: boolean; maxSteps?: number } = {}) {
  const lead = clients[0];
  for (let step = 0; step < (opts.maxSteps ?? 600); step++) {
    const g = lead.room!.game!;
    if (g.phase === 'gameOver') return;
    const rev = lead.room!.revision;
    const jobs: Promise<unknown>[] = [];
    for (const c of clients) {
      const cg = c.room?.game;
      if (!cg) continue;
      if (cg.phase === 'seasonEnd') jobs.push(c.seasonReady());
      else if (cg.turn && c.seat >= 0 && !cg.turn.submitted[c.seat]) jobs.push(c.playTurn());
    }
    if (opts.concurrent) await Promise.all(jobs);
    else for (const j of jobs) await j;
    await lead.waitFor(() => lead.room!.revision > rev || lead.room!.game!.phase === 'gameOver', 20000, 'progress');
  }
  throw new Error('game did not finish');
}
