// 게임 화면. 데스크톱: 큰 지도 + 옆 패널. 모바일: 지도 중심 + 패널 전환 + 하단 조작부.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ambushCard, cardName, exploreCard } from '../../engine/cards';
import { CONTENT_VERSION, SEASON_NAMES, ruinsOf } from '../../engine/game';
import { objective } from '../../engine/objectives';
import { pivotOf, transform } from '../../engine/shapes';
import { N, TERRAIN_CHAR, type DrawTerrain } from '../../engine/types';
import type { GameView, RoomView } from '../../room/types';
import { EMOTES, EMOTE_LABEL } from '../../shared/protocol';
import type { Session, Snapshot } from '../net/session';
import { profile } from '../storage';
import { Board, BoardSvg, type PreviewSpec } from './Board';
import { displayName, memberAtSeat, useDraft } from './model';
import { CardFace, Countdown, ObjectiveList, PlayerList, SeasonTrack, ShapeGlyph, TerrainButtons } from './parts';
import { Results } from './Results';
import { SeasonOverlay } from './SeasonOverlay';
import { TERRAIN_META } from './terrain';

function ghostCells(shapeCells: readonly (readonly [number, number])[], t: number, anchor: number): number[] {
  const v = transform(shapeCells, t);
  const [pr, pc] = pivotOf(v);
  const ar = Math.floor(anchor / N);
  const ac = anchor % N;
  const out: number[] = [];
  for (const [r, c] of v) {
    const rr = ar - pr + r;
    const cc = ac - pc + c;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
  }
  return out;
}

function withCells(board: string, cells: number[], terrain: DrawTerrain): string {
  const arr = board.split('');
  for (const i of cells) arr[i] = TERRAIN_CHAR[terrain];
  return arr.join('');
}

/** 새 사건을 짧은 알림으로 */
function useEventToasts(room: RoomView, game: GameView, youSeat: number) {
  const seen = useRef<Set<string> | null>(null);
  const [items, setItems] = useState<{ id: string; text: string; tone: string }[]>([]);
  useEffect(() => {
    const keyOf = (e: GameView['events'][number]) => JSON.stringify(e);
    if (seen.current === null) {
      // 처음 들어왔을 때 지난 사건은 알리지 않는다
      seen.current = new Set(game.events.map(keyOf));
      return;
    }
    const fresh: { id: string; text: string; tone: string }[] = [];
    for (const e of game.events) {
      const k = keyOf(e);
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      let text = '';
      let tone = 'info';
      if (e.type === 'ambush') {
        const a = ambushCard(e.card);
        text = `⚔ 매복! ${a?.name ?? ''} — 지도를 ${a?.direction === 'cw' ? '시계' : '반시계'} 방향으로 넘겨 이웃 지도에 몬스터를 그립니다`;
        tone = 'warn';
      } else if (e.type === 'solo-ambush') {
        text = e.cells ? `⚔ 매복: ${cardName(e.card)}의 몬스터가 지도에 나타났습니다` : `매복 ${cardName(e.card)}: 그릴 자리가 없어 무시되었습니다`;
        tone = 'warn';
      } else if (e.type === 'auto') {
        const who = displayName(memberAtSeat(room, e.seat));
        text = e.by === 'timeout' ? `⏱ 시간이 지나 ${who}님은 자동 배치되었습니다` : e.by === 'proxy' ? `🤖 ${who}님은 임시 봇이 대신 배치했습니다` : '';
      } else if (e.type === 'coin' && e.seat === youSeat) {
        text = e.reason === 'mountain' ? `🪙 산을 둘러싸서 코인 +${e.count}` : `🪙 코인 모양으로 코인 +${e.count}`;
        tone = 'good';
      } else if (e.type === 'ruins') {
        text = '🏛 폐허 카드! 이번 모양은 폐허 칸을 덮어야 합니다';
      } else if (e.type === 'deck-empty') {
        text = '탐험 덱이 바닥나 계절이 끝났습니다';
      }
      if (text) fresh.push({ id: k + Math.random(), text, tone });
    }
    if (fresh.length) {
      setItems((cur) => [...cur, ...fresh].slice(-4));
      const ids = fresh.map((f) => f.id);
      setTimeout(() => setItems((cur) => cur.filter((x) => !ids.includes(x.id))), 5000);
    }
  }, [game.events, room, youSeat]);
  return items;
}

export function GameScreen({ session, snap, onLeave }: { session: Session; snap: Snapshot; onLeave: () => void }) {
  const room = snap.room!;
  const game = room.game!;
  const you = room.you;
  const seat = you?.seat ?? -1;
  const isPlayer = seat >= 0;
  const turn = game.turn;
  const me = room.members.find((m) => m.id === you?.id);
  const { info, update, rotate, flip, nudge } = useDraft(game, seat);
  const [hover, setHover] = useState<number | null>(null);
  const [viewSeat, setViewSeat] = useState<number | null>(null);
  const [selObj, setSelObj] = useState<number | null>(null);
  const [tab, setTab] = useState<'card' | 'goals' | 'players'>('card');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [overlaySeen, setOverlaySeen] = useState<string>('');
  const [showTutorialHint, setShowTutorialHint] = useState(() => !profile.tutorialDone());
  const toasts = useEventToasts(room, game, seat);

  const mySubmitted = !!(turn && isPlayer && turn.submitted[seat]);
  const isAmbush = turn?.kind === 'ambush';
  const targetSeat = turn && isPlayer ? turn.targets[seat] : isPlayer ? seat : 0;
  const shownSeat = isPlayer ? (isAmbush ? targetSeat : seat) : (viewSeat ?? 0);
  const shownBoard = game.players[shownSeat]?.board ?? game.players[0].board;
  const req = info.req;
  const canAct = !!(turn && isPlayer && !mySubmitted && req && (game.phase === 'draw' || game.phase === 'ambush'));

  // 최근 바뀐 칸 반짝임
  const prevBoard = useRef<{ seat: number; board: string } | null>(null);
  const [fresh, setFresh] = useState<number[]>([]);
  useEffect(() => {
    const prev = prevBoard.current;
    if (prev && prev.seat === shownSeat && prev.board !== shownBoard) {
      const changed: number[] = [];
      for (let i = 0; i < shownBoard.length; i++) if (prev.board[i] !== shownBoard[i]) changed.push(i);
      setFresh(changed);
      const t = setTimeout(() => setFresh([]), 1600);
      prevBoard.current = { seat: shownSeat, board: shownBoard };
      return () => clearTimeout(t);
    }
    prevBoard.current = { seat: shownSeat, board: shownBoard };
  }, [shownBoard, shownSeat]);

  useEffect(() => setErr(null), [turn?.id]);

  // 미리보기
  let preview: PreviewSpec | null = null;
  if (canAct && req && !req.mustPass) {
    if (info.cells.length) {
      preview = { cells: info.cells, terrain: info.draft.terrain, valid: info.valid };
    } else if (hover !== null) {
      const cells = info.fallback ? [hover] : ghostCells(req.shapes[info.draft.shape]?.cells ?? [[0, 0]], info.draft.t, hover);
      preview = { cells, terrain: info.draft.terrain, valid: true, ghost: true };
    }
  }
  const pending = mySubmitted && turn?.mine && turn.mine.terrain && shownSeat === targetSeat ? { cells: turn.mine.cells, terrain: turn.mine.terrain } : null;

  // 목표 강조
  const ruins = ruinsOf(game);
  const highlight = useMemo(() => {
    if (selObj === null) return null;
    const res = objective(game.objectives[selObj]).score({ board: shownBoard, ruins });
    return { cells: res.cells, tone: 'gold' as const, note: res.note };
  }, [selObj, game.objectives, shownBoard, ruins]);

  // 예상 점수용 초안 보드(내 지도에 그리는 턴만)
  const myBoard = isPlayer ? game.players[seat].board : null;
  const draftBoard = useMemo(() => {
    if (!isPlayer || isAmbush || !info.valid || !info.cells.length || mySubmitted) return null;
    return withCells(game.players[seat].board, info.cells, info.draft.terrain);
  }, [isPlayer, isAmbush, info.valid, info.cells, info.draft.terrain, mySubmitted, game.players, seat]);

  const confirm = async () => {
    if (!turn || !info.placement || !info.valid || busy) return;
    setBusy(true);
    setErr(null);
    const res = await session.send({ a: 'place', turnId: turn.id, placement: info.placement, target: turn.targets[seat] });
    setBusy(false);
    if (!res.ok) setErr(res.err ?? '배치하지 못했습니다');
  };

  // 키보드
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!canAct || !req) return;
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowUp') nudge(-1, 0);
      else if (e.key === 'ArrowDown') nudge(1, 0);
      else if (e.key === 'ArrowLeft') nudge(0, -1);
      else if (e.key === 'ArrowRight') nudge(0, 1);
      else if (k === 'r') rotate();
      else if (k === 'f') flip();
      else if (e.key === 'Enter') void confirm();
      else if (/^[1-4]$/.test(k) && req.shapes[Number(k) - 1] && !info.fallback) update({ shape: Number(k) - 1 });
      else {
        const terrains = info.fallback ? req.fallbackTerrains : req.terrains;
        const idx = 'qwert'.indexOf(k);
        if (idx >= 0 && terrains[idx]) update({ terrain: terrains[idx] });
        else return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 계절 채점 연출
  const overlayKey = game.phase === 'seasonEnd' || game.phase === 'gameOver' ? `${game.no}:${game.phase === 'gameOver' ? 3 : game.season}` : '';
  const showOverlay = overlayKey !== '' && overlaySeen !== overlayKey;
  if (game.phase === 'gameOver' && !showOverlay) {
    return <Results session={session} snap={snap} onLeave={onLeave} />;
  }

  const submittedCount = turn ? turn.submitted.filter(Boolean).length : 0;
  const targetName = displayName(memberAtSeat(room, targetSeat));

  // 지금 할 일
  let doNow = '';
  let doTone = 'normal';
  if (!isPlayer) doNow = '관전 중입니다. 참가자 목록에서 지도를 눌러 살펴볼 수 있어요.';
  else if (game.phase === 'seasonEnd') doNow = `${SEASON_NAMES[game.season]} 채점 결과를 확인하세요.`;
  else if (!turn) doNow = '다음 카드를 여는 중…';
  else if (mySubmitted) doNow = `확정 완료 — 다른 참가자를 기다리는 중 (${submittedCount}/${turn.submitted.length})`;
  else if (req?.mustPass) doNow = '빈칸이 없어 이번 턴은 건너뜁니다. [건너뛰기]를 누르세요.';
  else if (isAmbush) {
    doNow = `⚔ 매복! ${targetName}님의 지도에 몬스터를 그리세요.`;
    doTone = 'ambush';
  } else if (req?.mustFallback) {
    doNow = req.ruinsUnavailable
      ? '폐허를 덮을 수 없어요. 원하는 지형으로 아무 빈칸 1칸을 그리세요.'
      : '카드 모양을 놓을 자리가 없어요. 원하는 지형으로 아무 빈칸 1칸을 그리세요.';
    doTone = 'warn';
  } else if (info.draft.anchor === null) doNow = turn.ruins ? '🏛 폐허 효과: 폐허 칸(점선)을 하나 이상 덮도록 놓으세요. 지도에서 칸을 누르세요.' : '① 지형·모양 고르기 → ② 지도에서 칸 누르기 → ③ 회전·반전 → ④ 배치 확정';
  else if (!info.valid) {
    doNow = info.error ?? '놓을 수 없는 자리입니다';
    doTone = 'bad';
  } else doNow = '좋아요! [배치 확정]을 누르세요. 확정 전에는 얼마든지 바꿀 수 있어요.';

  const terrains = req ? (info.fallback ? req.fallbackTerrains : req.terrains) : [];

  const controls = canAct && req && (
    <div className="controls">
      {req.mustPass ? (
        <button type="button" className="btn primary big" onClick={() => void session.send({ a: 'place', turnId: turn!.id, placement: { kind: 'pass' }, target: turn!.targets[seat] })}>
          건너뛰기
        </button>
      ) : (
        <>
          {!info.fallback && req.shapes.length > 1 && (
            <div className="seg shape-seg" role="radiogroup" aria-label="모양 선택">
              {req.shapes.map((s, i) => (
                <button type="button" key={i} role="radio" aria-checked={info.draft.shape === i} className={'seg-btn' + (info.draft.shape === i ? ' on' : '')} onClick={() => update({ shape: i })} title={`모양 ${i + 1} (단축키 ${i + 1})`}>
                  <ShapeGlyph cells={s.cells} t={info.draft.shape === i ? info.draft.t : 0} coin={s.coin} size={40} color={TERRAIN_META[info.draft.terrain].color} />
                  {s.coin && <span className="coin-note">코인</span>}
                </button>
              ))}
            </div>
          )}
          {terrains.length > 1 && <TerrainButtons terrains={terrains} value={info.draft.terrain} onChange={(t) => update({ terrain: t })} />}
          {terrains.length === 1 && (
            <div className="single-terrain">
              지형: <b>{TERRAIN_META[terrains[0]].label}</b>
            </div>
          )}
        </>
      )}
    </div>
  );

  const actionBar = canAct && req && !req.mustPass && (
    <div className="action-bar" role="toolbar" aria-label="배치 조작">
      {!info.fallback && (
        <>
          <button type="button" className="btn icon" onClick={rotate} aria-label="회전 (R)" title="시계 방향 회전 (R)">
            ⟳<span>회전</span>
          </button>
          <button type="button" className="btn icon" onClick={flip} aria-label="좌우 반전 (F)" title="좌우 반전 (F)">
            ⇋<span>반전</span>
          </button>
        </>
      )}
      <div className="nudge" aria-label="한 칸씩 옮기기">
        <button type="button" className="btn tiny" onClick={() => nudge(0, -1)} aria-label="왼쪽으로">◀</button>
        <div className="nudge-col">
          <button type="button" className="btn tiny" onClick={() => nudge(-1, 0)} aria-label="위로">▲</button>
          <button type="button" className="btn tiny" onClick={() => nudge(1, 0)} aria-label="아래로">▼</button>
        </div>
        <button type="button" className="btn tiny" onClick={() => nudge(0, 1)} aria-label="오른쪽으로">▶</button>
      </div>
      <button type="button" className="btn primary confirm" disabled={!info.valid || busy} onClick={() => void confirm()}>
        {busy ? '보내는 중…' : '배치 확정'}
      </button>
    </div>
  );

  return (
    <div className={'game-screen' + (isAmbush && canAct ? ' mode-ambush' : '')}>
      <header className="game-top">
        <SeasonTrack game={game} />
        <div className="top-right">
          {turn?.deadline && <Countdown deadline={turn.deadline} skew={snap.clockSkew} />}
          <ConnBadge snap={snap} />
          <button type="button" className="btn ghost small" onClick={onLeave}>
            나가기
          </button>
        </div>
      </header>

      {me?.proxy && (
        <div className="banner warn">
          지금은 임시 봇이 대신 두고 있어요.{' '}
          <button type="button" className="btn small" onClick={() => void session.send({ a: 'takeBack' })}>
            내가 직접 하기
          </button>
        </div>
      )}
      {room.paused && <div className="banner">접속한 사람이 없어 진행이 잠시 멈췄습니다.</div>}
      {game.rules !== CONTENT_VERSION && (
        <div className="banner warn">
          이 기기의 화면과 서버의 규칙 데이터 버전이 다릅니다. 새로 배포된 앱을 받으려면{' '}
          <button type="button" className="btn small" onClick={() => location.reload()}>
            새로고침
          </button>
        </div>
      )}
      {showTutorialHint && isPlayer && game.turn && (
        <div className="banner tip">
          처음이신가요? <a href="/tutorial">1분 체험 튜토리얼</a>로 배치·회전·확정을 연습해 보세요.
          <button type="button" className="btn ghost small" onClick={() => { profile.setTutorialDone(); setShowTutorialHint(false); }}>
            닫기
          </button>
        </div>
      )}

      <div className="game-layout">
        <main className="board-area">
          <div className={'do-now tone-' + doTone} role="status" aria-live="polite">
            {doNow}
          </div>
          {isPlayer && isAmbush && (
            <div className="ambush-title">
              <span>⚔</span> <b>{targetName}</b>님의 지도 <small>(내 지도가 아닙니다)</small>
            </div>
          )}
          {!isPlayer && (
            <div className="view-title">
              👀 {displayName(memberAtSeat(room, shownSeat))}님의 지도
            </div>
          )}
          <Board
            board={shownBoard}
            mapSide={game.mapSide}
            preview={preview}
            pending={pending}
            highlight={highlight ? { cells: highlight.cells, tone: highlight.tone } : null}
            fresh={fresh}
            onCellTap={canAct ? (cell) => update({ anchor: cell }) : undefined}
            onCellHover={canAct ? setHover : undefined}
            className={isAmbush && isPlayer ? 'frame-ambush' : 'frame-mine'}
          />
          {highlight && (
            <div className="hl-note">
              <b>{objective(game.objectives[selObj!]).name}</b>: {highlight.note}{' '}
              <button type="button" className="btn ghost small" onClick={() => setSelObj(null)}>
                강조 끄기
              </button>
            </div>
          )}
          {err && <div className="error-line">{err}</div>}
          {(actionBar || (canAct && req?.mustPass)) && (
            <div className="action-dock">
              {/* 모바일: 지도에서 눈을 떼지 않고 모양·지형을 바꿀 수 있게 하단에 한 줄 더 */}
              {turn && <div className="quick-controls">
                <span className="quick-card">{cardName(turn.card)}</span>
                {controls}
              </div>}
              {actionBar}
            </div>
          )}
        </main>

        <aside className="side-panel">
          <nav className="tabs" aria-label="패널">
            <button type="button" className={tab === 'card' ? 'on' : ''} onClick={() => setTab('card')}>
              카드
            </button>
            <button type="button" className={tab === 'goals' ? 'on' : ''} onClick={() => setTab('goals')}>
              목표
            </button>
            <button type="button" className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>
              참가자 {turn ? `${submittedCount}/${turn.submitted.length}` : ''}
            </button>
          </nav>

          <section className={'panel panel-card' + (tab === 'card' ? ' show' : '')}>
            <h3>이번 카드</h3>
            {turn ? (
              <>
                {turn.revealed.length > 1 && (
                  <div className="revealed-chain">
                    {turn.revealed.slice(0, -1).map((id, i) => (
                      <CardFace key={id + i} id={id} compact />
                    ))}
                  </div>
                )}
                <CardFace id={turn.card} />
                {turn.ruins && <p className="ruins-flag">🏛 폐허 효과 적용 중</p>}
                {isAmbush && (
                  <p className="ambush-help">
                    몬스터 옆 빈칸은 계절마다 상대에게 −1점입니다. 합법적인 자리에만 놓을 수 있어요.
                  </p>
                )}
                {controls}
                {mySubmitted && <p className="waiting">✓ 확정했습니다. 다른 사람을 기다리는 동안 참가자 탭에서 지도를 구경하세요.</p>}
              </>
            ) : (
              <p>카드를 기다리는 중…</p>
            )}
            <div className="column">
              <h4>이번 계절에 공개된 카드</h4>
              <div className="column-list">
                {game.column.map((id, i) => {
                  const c = exploreCard(id);
                  return (
                    <span key={id + i} className="chip" title={c?.name}>
                      {c?.name} ⏳{c?.time}
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          <section className={'panel panel-goals' + (tab === 'goals' ? ' show' : '')}>
            <h3>목표 (눌러서 지도에 표시)</h3>
            <ObjectiveList game={game} board={isAmbush ? shownBoard : (myBoard ?? shownBoard)} draftBoard={room.settings.hints ? draftBoard : null} hints={room.settings.hints} selected={selObj} onSelect={setSelObj} />
            {isPlayer && (
              <div className="my-coins">
                🪙 코인 {game.players[seat].coins}개 (계절마다 코인 수만큼 점수) · 몬스터 벌점은 계절 끝에 계산
              </div>
            )}
          </section>

          <section className={'panel panel-players' + (tab === 'players' ? ' show' : '')}>
            <h3>참가자 {turn && <small>배치 완료 {submittedCount}/{turn.submitted.length}</small>}</h3>
            <PlayerList room={room} game={game} youId={you?.id ?? null} emotes={snap.emotes} onView={(s) => setViewSeat(s)} highlightSeat={isAmbush ? targetSeat : null} />
            {you?.isHost && turn && (
              <HostProxy room={room} game={game} session={session} />
            )}
            <div className="emotes" role="group" aria-label="감정 표현">
              {EMOTES.map((k) => (
                <button type="button" key={k} className="emote" onClick={() => void session.send({ a: 'emote', key: k })} title={EMOTE_LABEL[k].text}>
                  {EMOTE_LABEL[k].icon}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast tone-' + t.tone}>
            {t.text}
          </div>
        ))}
        {snap.toast && <ToastOnce key={snap.toast.id} text={snap.toast.text} tone={snap.toast.tone} />}
      </div>

      {viewSeat !== null && isPlayer && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="지도 보기" onClick={() => setViewSeat(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <h3>
              {displayName(memberAtSeat(room, viewSeat))}님의 지도 <small>(확정된 배치만 보입니다)</small>
            </h3>
            <div className="modal-board">
              <BoardSvg board={game.players[viewSeat].board} mapSide={game.mapSide} suffix="-modal" />
            </div>
            <p>
              ★ {game.players[viewSeat].total}점 · 🪙 {game.players[viewSeat].coins}
            </p>
            <button type="button" className="btn" onClick={() => setViewSeat(null)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {showOverlay && (
        <SeasonOverlay
          room={room}
          game={game}
          youSeat={seat}
          skew={snap.clockSkew}
          onReady={() => void session.send({ a: 'seasonReady', season: game.season })}
          onClose={() => setOverlaySeen(overlayKey)}
        />
      )}
    </div>
  );
}

function HostProxy({ room, game, session }: { room: RoomView; game: GameView; session: Session }) {
  const turn = game.turn;
  if (!turn) return null;
  const idle = room.seats
    .map((id, seat) => ({ m: room.members.find((x) => x.id === id), seat }))
    .filter(({ m, seat }) => m && m.kind === 'human' && !m.proxy && !turn.submitted[seat] && m.id !== room.you?.id);
  if (!idle.length) return null;
  return (
    <div className="host-proxy">
      <small>방장 도구: 응답이 없는 참가자를 임시 봇으로 대신 진행</small>
      {idle.map(({ m }) => (
        <button type="button" key={m!.id} className="btn small" onClick={() => void session.send({ a: 'proxy', memberId: m!.id })}>
          {displayName(m)} 대리 진행
        </button>
      ))}
    </div>
  );
}

export function ConnBadge({ snap }: { snap: Snapshot }) {
  if (snap.kind === 'local') return <span className="conn local">혼자 하기</span>;
  const label = snap.conn === 'open' ? '연결됨' : snap.conn === 'reconnecting' ? '다시 연결 중…' : snap.conn === 'connecting' ? '연결 중…' : '연결 끊김';
  return (
    <span className={'conn ' + snap.conn} role="status">
      <span className="dot" aria-hidden="true" /> {label} · {snap.code}
    </span>
  );
}

function ToastOnce({ text, tone }: { text: string; tone: string }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return <div className={'toast tone-' + tone}>{text}</div>;
}

export function cardLabel(id: string) {
  return cardName(id);
}
