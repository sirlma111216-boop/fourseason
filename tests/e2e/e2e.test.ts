// 실제 브라우저(설치된 Chrome) + 실제 로컬 Worker 로 하는 화면 시험.
// 서로 독립된 브라우저 컨텍스트 두 개가 같은 방에서 끝까지 두고, 모바일 화면에서 탭으로 배치한다.
// 실행: npm run test:e2e
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeServer } from '../net/server';
import { UiPlayer } from './ui-player';

const server = makeServer(8789, 'e2e');
const BASE = server.base;
const ART = resolve(__dirname, 'artifacts');
let browser: Browser;

async function newPage(ctxOpts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  mkdirSync(ART, { recursive: true });
  await page.screenshot({ path: resolve(ART, name + '.png'), fullPage: false });
}

beforeAll(async () => {
  server.resetState();
  await server.start();
  browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'chrome', headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server.stop();
});

describe('두 브라우저가 같은 방에서 한 판', () => {
  it('닉네임 입장 → 준비 → 동시 배치 → 매복 → 계절 채점 → 결과·갤러리·PNG·다시 보기 → 재경기', async () => {
    const A = await newPage();
    const B = await newPage();
    const a = new UiPlayer(A.page, '가람');
    const b = new UiPlayer(B.page, '나래');

    // A: 첫 화면에서 방 만들기
    await A.page.goto(BASE + '/');
    await expect(A.page.getByRole('heading', { name: '사계절의 지도' }).isVisible()).resolves.toBe(true);
    await shot(A.page, '01-title');
    await A.page.getByPlaceholder('지도사 이름 (최대 12자)').fill('가람');
    await A.page.getByRole('button', { name: '방 만들기' }).click();
    await A.page.waitForURL(/\/r\/[A-Z0-9]{6}$/);
    const code = A.page.url().split('/r/')[1];
    await a.waitRoom((r) => r.status === 'lobby', 15_000, 'lobby');
    await shot(A.page, '02-lobby-host');

    // B: 공유 링크로 들어와 닉네임 입력
    await B.page.goto(BASE + '/r/' + code);
    await B.page.getByRole('textbox').fill('나래');
    await B.page.getByRole('button', { name: '참가하기' }).click();
    await b.waitRoom((r) => r.members.length === 2, 15_000, 'b joined');
    await B.page.getByRole('button', { name: '준비 완료' }).click();
    await a.waitRoom((r) => r.members.every((m) => m.ready || m.isHost), 10_000, 'b ready');

    // 방장 설정: 시간 제한 없음, 시작
    await A.page.getByRole('radio', { name: '없음' }).click();
    await a.waitRoom((r) => r.settings.turnSeconds === 0, 5000, 'setting');
    await A.page.getByRole('button', { name: '게임 시작' }).click();
    await a.waitRoom((r) => !!r.game?.turn, 15_000, 'game start');
    await b.waitRoom((r) => !!r.game?.turn, 15_000, 'game start b');
    await shot(A.page, '03-game-desktop');

    // 개인정보: B 가 보낸 프레임에는 닉네임과 자기 복귀 정보만, A 의 비밀 토큰은 어디에도 없다
    const aSecret = await A.page.evaluate((c) => JSON.parse(localStorage.getItem('sgjd.room.' + c) || '{}').secret, code);
    expect(aSecret).toBeTruthy();
    expect(b.received.join('')).not.toContain(aSecret);
    expect(b.sent.join('')).not.toContain(aSecret);
    expect(A.page.url()).not.toContain(aSecret);

    let refreshed = false;
    let sawAmbush = false;
    let sawSeasonOverlay = false;
    for (let step = 0; step < 400; step++) {
      const ga = a.room?.game;
      if (ga?.phase === 'gameOver' && (await A.page.getByText('지도 완성!').isVisible().catch(() => false)) && (await B.page.getByText('지도 완성!').isVisible().catch(() => false))) break;
      if (ga?.turn?.kind === 'ambush' && !sawAmbush) {
        sawAmbush = true;
        await A.page.waitForTimeout(300);
        await shot(A.page, '04-ambush');
        expect(await A.page.locator('.ambush-title').isVisible()).toBe(true);
      }
      if ((ga?.phase === 'seasonEnd' || ga?.phase === 'gameOver') && !sawSeasonOverlay) {
        await A.page.waitForTimeout(600);
        if (await A.page.locator('.season-overlay').isVisible().catch(() => false)) {
          sawSeasonOverlay = true;
          await A.page.waitForTimeout(8000); // 연출 끝까지
          await shot(A.page, '05-season-overlay');
        }
      }
      // 중간에 B 새로고침 → 같은 자리로 복귀
      if (!refreshed && ga && ga.season === 1 && ga.turn) {
        const idBefore = b.room!.you!.id;
        await B.page.reload();
        await b.waitRoom((r) => !!r.game && r.you?.id === idBefore, 20_000, 'b resumed');
        refreshed = true;
      }
      const did = (await a.playTurnViaUi()) || (await b.playTurnViaUi()) || (await a.handleOverlay()) || (await b.handleOverlay());
      if (!did) await A.page.waitForTimeout(150);
    }
    expect(refreshed).toBe(true);
    expect(sawAmbush).toBe(true);
    expect(sawSeasonOverlay).toBe(true);
    await expect(A.page.getByText('지도 완성!').isVisible()).resolves.toBe(true);
    await shot(A.page, '06-results');

    const g = a.room!.game!;
    expect(g.phase).toBe('gameOver');
    expect(g.players[0].board).not.toBe(g.players[1].board);
    expect(await A.page.locator('.gallery-item').count()).toBe(2);
    expect(await A.page.locator('.results-table tbody tr').count()).toBe(2);

    // 내 지도 PNG 저장
    const [download] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: /내 지도 PNG 저장/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^사계절의지도_가람\.png$/);
    expect(download.suggestedFilename()).not.toContain(code);

    // 지도 성장 다시 보기
    await A.page.locator('.replay input[type=range]').fill('3');
    expect(await A.page.locator('.replay-caption').innerText()).toMatch(/봄|여름|가을|겨울/);

    // 재경기
    await A.page.getByRole('button', { name: '같은 참가자로 다시 하기' }).click();
    await b.waitRoom((r) => r.game?.no === 2 && !!r.game.turn, 15_000, 'rematch');
    expect(await B.page.locator('.board-viewport').isVisible()).toBe(true);
    await A.ctx.close();
    await B.ctx.close();
  }, 600_000);
});

describe('모바일 화면', () => {
  it('작은 화면에서 탭으로 위치 지정 → 회전 → 확정, 가로 스크롤 없음', async () => {
    const M = await newPage({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const m = new UiPlayer(M.page, '모바일');
    await M.page.goto(BASE + '/');
    await shot(M.page, '10-mobile-title');
    await M.page.getByPlaceholder('지도사 이름 (최대 12자)').fill('모바일');
    await M.page.getByRole('button', { name: '혼자 플레이' }).tap();
    await M.page.getByRole('button', { name: '시작하기' }).tap();
    await M.page.waitForURL(/\/play$/);
    await M.page.locator('.board-viewport').waitFor();
    const overflow = await M.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(M.page, '11-mobile-game');
    // 하단 조작부가 보이고, 확정 버튼은 위치를 정하기 전에는 비활성
    const confirm = M.page.locator('.action-bar .confirm');
    expect(await confirm.isVisible()).toBe(true);
    expect(await confirm.isDisabled()).toBe(true);
    // 탭 조작만으로 한 턴(혼자 하기는 로컬 방이라 WebSocket 이 없다 → 화면 상태로 확인)
    const before = await M.page.locator('.time-bar em').innerText();
    await M.page.locator('.board-viewport').scrollIntoViewIfNeeded();
    const box = (await M.page.locator('.board-viewport svg.board-svg').boundingBox())!;
    const span = 11 + 2 * 0.65;
    let placed = false;
    for (const [r, c] of [[6, 6], [4, 1], [8, 5], [2, 4], [6, 9], [9, 9]]) {
      await M.page.touchscreen.tap(box.x + ((c + 0.5 + 0.65) / span) * box.width, box.y + ((r + 0.5 + 0.65) / span) * box.height);
      await M.page.getByRole('button', { name: '회전 (R)' }).tap().catch(() => undefined);
      if (await confirm.isEnabled()) {
        await shot(M.page, '12-mobile-preview');
        await confirm.tap();
        placed = true;
        break;
      }
    }
    expect(placed).toBe(true);
    await M.page.waitForFunction((b) => document.querySelector('.time-bar em')?.textContent !== b || !!document.querySelector('.season-overlay'), before, { timeout: 10_000 });
    // 확대 버튼과 이동 모드
    await M.page.getByRole('button', { name: '확대' }).tap();
    expect(await M.page.locator('.board-tools .tool').count()).toBeGreaterThanOrEqual(4);
    // 패널 전환 탭
    await M.page.getByRole('button', { name: '목표' }).tap();
    expect(await M.page.locator('.panel-goals.show').isVisible()).toBe(true);
    await shot(M.page, '13-mobile-goals');
    void m;
    await M.ctx.close();
  }, 180_000);
});

describe('튜토리얼', () => {
  it('직접 조작하는 5단계를 끝까지 할 수 있다', async () => {
    const T = await newPage();
    await T.page.goto(BASE + '/tutorial');
    await T.page.locator('.terrain-seg .seg-btn').nth(1).click(); // 농지
    const box = (await T.page.locator('.board-viewport svg.board-svg').boundingBox())!;
    const span = 11 + 2 * 0.65;
    const tap = (r: number, c: number) => T.page.mouse.click(box.x + ((c + 0.5 + 0.65) / span) * box.width, box.y + ((r + 0.5 + 0.65) / span) * box.height);
    await tap(5, 8);
    await T.page.getByRole('button', { name: /회전/ }).click();
    await T.page.getByRole('button', { name: /반전/ }).click();
    await T.page.locator('.objective').nth(1).click();
    await shot(T.page, '20-tutorial');
    const confirm = T.page.getByRole('button', { name: '배치 확정' });
    if (await confirm.isDisabled()) await tap(4, 7);
    await confirm.click();
    await T.page.getByText('잘했어요').waitFor({ timeout: 5000 });
    await T.ctx.close();
  }, 120_000);
});
