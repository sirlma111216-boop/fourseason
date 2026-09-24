// 실제 브라우저 화면을 조작하는 시험 참가자.
// 서버가 보낸 WebSocket 프레임(실제 화면이 받는 것과 같은 것)으로 상황을 읽고,
// 규칙 엔진으로 합법 배치를 고른 뒤, 사람처럼 버튼과 지도 칸을 눌러 확정한다.
import type { Page, WebSocket as PwWebSocket } from 'playwright-core';
import { chooseBotPlacement } from '../../src/engine/bot';
import { requirement } from '../../src/engine/game';
import { pivotOf, transform } from '../../src/engine/shapes';
import { N } from '../../src/engine/types';
import type { RoomView } from '../../src/room/types';
import { engineState } from '../../src/room/view-state';

const LABEL_MARGIN = 0.65; // Board.tsx 의 좌표 글자 여백(viewBox)

export class UiPlayer {
  room: RoomView | null = null;
  sent: string[] = [];
  received: string[] = [];
  private lastTurnKey = '';

  constructor(
    public page: Page,
    public name: string,
  ) {
    page.on('websocket', (ws: PwWebSocket) => {
      ws.on('framereceived', (f) => {
        const text = typeof f.payload === 'string' ? f.payload : f.payload.toString();
        this.received.push(text);
        try {
          const m = JSON.parse(text);
          if ((m.t === 'welcome' || m.t === 'state') && (!this.room || m.room.revision >= this.room.revision || m.t === 'welcome')) this.room = m.room;
        } catch {
          /* pong 등 */
        }
      });
      ws.on('framesent', (f) => {
        this.sent.push(typeof f.payload === 'string' ? f.payload : f.payload.toString());
      });
    });
  }

  async waitRoom(pred: (r: RoomView) => boolean, timeout = 30_000, label = 'room condition') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (this.room && pred(this.room)) return;
      await this.page.waitForTimeout(100);
    }
    throw new Error(`${this.name}: timeout waiting for ${label}`);
  }

  private async cellPoint(cell: number) {
    const box = await this.page.locator('.board-viewport svg.board-svg').first().boundingBox();
    if (!box) throw new Error('no board');
    const span = N + 2 * LABEL_MARGIN;
    const r = Math.floor(cell / N);
    const c = cell % N;
    return {
      x: box.x + ((c + 0.5 + LABEL_MARGIN) / span) * box.width,
      y: box.y + ((r + 0.5 + LABEL_MARGIN) / span) * box.height,
    };
  }

  async tapCell(cell: number, touch = false) {
    const p = await this.cellPoint(cell);
    if (touch) await this.page.touchscreen.tap(p.x, p.y);
    else await this.page.mouse.click(p.x, p.y);
  }

  /** 지금 둘 차례면 화면 조작으로 한 턴을 확정한다. 했으면 true. */
  async playTurnViaUi(opts: { touch?: boolean } = {}): Promise<boolean> {
    const room = this.room;
    const g = room?.game;
    const seat = room?.you?.seat ?? -1;
    if (!room || !g || !g.turn || seat < 0 || g.turn.submitted[seat]) return false;
    const key = g.no + ':' + g.turn.id;
    if (this.lastTurnKey === key) return false;
    const st = engineState(g);
    const req = requirement(st, seat)!;
    const choice = chooseBotPlacement(st, seat, 'easy', g.turn.id * 13 + seat).placement;
    const click = async (sel: string, nth = 0) => {
      const loc = this.page.locator(sel).nth(nth);
      if (opts.touch) await loc.tap();
      else await loc.click();
    };
    if (choice.kind === 'pass') {
      await this.page.locator('button:visible', { hasText: '건너뛰기' }).first().click();
    } else if (choice.kind === 'single') {
      const terrains = req.fallbackTerrains;
      if (terrains.length > 1) await click('.terrain-seg .seg-btn:visible', terrains.indexOf(choice.terrain));
      await this.tapCell(choice.row * N + choice.col, opts.touch);
      await this.page.locator('.action-bar .confirm:not([disabled])').waitFor({ timeout: 5000 });
      await click('.action-bar .confirm');
    } else {
      if (req.shapes.length > 1) await click('.shape-seg .seg-btn:visible', choice.shape);
      if (req.terrains.length > 1) await click('.terrain-seg .seg-btn:visible', req.terrains.indexOf(choice.terrain));
      if (choice.t >= 4) await click('button[aria-label="좌우 반전 (F)"]');
      for (let i = 0; i < choice.t % 4; i++) await click('button[aria-label="회전 (R)"]');
      const v = transform(req.shapes[choice.shape].cells, choice.t);
      const [pr, pc] = pivotOf(v);
      await this.tapCell((choice.row + pr) * N + (choice.col + pc), opts.touch);
      await this.page.locator('.action-bar .confirm:not([disabled])').waitFor({ timeout: 5000 });
      await click('.action-bar .confirm');
    }
    this.lastTurnKey = key;
    await this.waitRoom((r) => !r.game?.turn || r.game.turn.id !== g.turn!.id || !!r.game.turn.submitted[seat], 15_000, 'submission reflected');
    return true;
  }

  /** 계절 채점 연출에서 준비 완료 / 최종 결과 보기 */
  async handleOverlay(): Promise<boolean> {
    // 연출 중에 다음 계절로 넘어가 버튼이 사라질 수 있으므로 짧게 기다리고 실패는 넘어간다.
    const ready = this.page.getByRole('button', { name: /시작 준비 완료/ });
    if (await ready.isVisible().catch(() => false)) {
      if (await ready.isEnabled({ timeout: 1000 }).catch(() => false)) {
        const ok = await ready.click({ timeout: 2000 }).then(() => true).catch(() => false);
        if (ok) return true;
      }
    }
    const final = this.page.getByRole('button', { name: '최종 결과 보기' });
    if (await final.isVisible().catch(() => false)) {
      return final.click({ timeout: 2000 }).then(() => true).catch(() => false);
    }
    return false;
  }
}
