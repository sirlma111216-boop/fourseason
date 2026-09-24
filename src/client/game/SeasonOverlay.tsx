// 계절 채점 연출: 목표 1 → 목표 2 → 코인 → 몬스터 벌점 → 합계 → 순위 변화.
// 연출은 화면에서만 돈다(건너뛸 수 있다). 다음 계절로 넘어가는 것은 서버가 정한다.

import { useEffect, useMemo, useState } from 'react';
import { EDICT_LETTERS, SEASON_NAMES, scoreBoard } from '../../engine/game';
import { objective } from '../../engine/objectives';
import type { GameView, RoomView } from '../../room/types';
import { BoardSvg } from './Board';
import { displayName, memberAtSeat } from './model';
import { Countdown } from './parts';

type Step = 'obj0' | 'obj1' | 'coins' | 'monsters' | 'total' | 'ranking';
const STEPS: Step[] = ['obj0', 'obj1', 'coins', 'monsters', 'total', 'ranking'];

export interface RankRow {
  seat: number;
  season: number;
  total: number;
  before: number;
  rank: number;
  rankBefore: number;
  monsters: number;
}

export function rankRows(game: GameView, season: number): RankRow[] {
  const rows = game.players.map((p, seat) => {
    const upto = p.seasons.filter((s) => s.season <= season);
    const total = upto.reduce((a, s) => a + s.total, 0);
    const thisSeason = p.seasons.find((s) => s.season === season)?.total ?? 0;
    const monsters = upto.reduce((a, s) => a + s.monsters, 0);
    const monstersBefore = upto.filter((s) => s.season < season).reduce((a, s) => a + s.monsters, 0);
    return { seat, season: thisSeason, total, before: total - thisSeason, monsters, monstersBefore, rank: 0, rankBefore: 0 };
  });
  for (const r of rows) {
    r.rank = 1 + rows.filter((o) => o.total > r.total || (o.total === r.total && o.monsters < r.monsters)).length;
    r.rankBefore = 1 + rows.filter((o) => o.before > r.before || (o.before === r.before && o.monstersBefore < r.monstersBefore)).length;
  }
  return rows.sort((a, b) => a.rank - b.rank || a.seat - b.seat);
}

export function SeasonOverlay({
  room,
  game,
  youSeat,
  skew,
  onReady,
  onClose,
}: {
  room: RoomView;
  game: GameView;
  youSeat: number;
  skew: number;
  onReady: () => void;
  onClose: () => void;
}) {
  const season = game.phase === 'gameOver' ? 3 : game.season;
  const [focus, setFocus] = useState(youSeat >= 0 ? youSeat : 0);
  const p = game.players[focus];
  const confirmed = p.seasons.find((s) => s.season === season);
  const detail = useMemo(() => scoreBoard(game, p.board, season, p.coins), [game, p.board, season, p.coins]);
  const [step, setStep] = useState(0);
  const cur = STEPS[step];
  const ready = !!room.you && game.seasonReady.includes(room.you.id);
  const over = game.phase === 'gameOver';

  useEffect(() => {
    if (step >= STEPS.length - 1) return;
    const t = setTimeout(() => setStep((s) => s + 1), 1500);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    // 화면 계산과 서버 확정 점수가 다르면 개발 중에 바로 알 수 있게 남긴다.
    if (confirmed && confirmed.total !== detail.total) console.warn('점수 계산 차이', confirmed, detail);
  }, [confirmed, detail]);

  const highlight =
    cur === 'obj0'
      ? { cells: detail.results[0].cells, tone: 'gold' as const }
      : cur === 'obj1'
        ? { cells: detail.results[1].cells, tone: 'gold' as const }
        : cur === 'monsters'
          ? { cells: detail.monsterCells, tone: 'red' as const }
          : null;

  const rows = rankRows(game, season);
  const shown = (s: Step) => STEPS.indexOf(s) <= step;
  const pts = confirmed ? confirmed.points : [detail.results[0].points, detail.results[1].points];

  return (
    <div className="overlay season-overlay" role="dialog" aria-modal="true" aria-label={`${SEASON_NAMES[season]} 채점`}>
      <div className={'overlay-card season-bg-' + season}>
        <header className="ov-head">
          <h2>{SEASON_NAMES[season]} 채점</h2>
          {!over && game.seasonDeadline && <Countdown deadline={game.seasonDeadline} skew={skew} label="다음 계절까지" />}
          {step < STEPS.length - 1 && (
            <button type="button" className="btn ghost small" onClick={() => setStep(STEPS.length - 1)}>
              연출 건너뛰기
            </button>
          )}
        </header>
        <div className="ov-body">
          <div className="ov-board">
            <div className="ov-who">
              {game.players.length > 1 && (
                <select value={focus} onChange={(e) => setFocus(Number(e.target.value))} aria-label="채점 내역을 볼 참가자">
                  {game.players.map((_, s) => (
                    <option key={s} value={s}>
                      {displayName(memberAtSeat(room, s))}
                      {s === youSeat ? ' (나)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <BoardSvg board={p.board} mapSide={game.mapSide} highlight={highlight} suffix="-ov" />
          </div>
          <div className="ov-lines">
            {[0, 1].map((k) => {
              const slot = detail.edicts[k];
              const o = objective(game.objectives[slot]);
              return (
                <div key={k} className={'ov-line' + (shown(k === 0 ? 'obj0' : 'obj1') ? ' in' : '') + (cur === (k === 0 ? 'obj0' : 'obj1') ? ' now' : '')}>
                  <span className="lbl">
                    {EDICT_LETTERS[slot]} · {o.name}
                  </span>
                  <span className="val confirmed">+{pts[k]}</span>
                  <small>{detail.results[k].note}</small>
                </div>
              );
            })}
            <div className={'ov-line' + (shown('coins') ? ' in' : '') + (cur === 'coins' ? ' now' : '')}>
              <span className="lbl">🪙 코인</span>
              <span className="val confirmed">+{confirmed?.coins ?? detail.coins}</span>
              <small>모은 코인은 계절마다 다시 점수가 됩니다</small>
            </div>
            <div className={'ov-line minus' + (shown('monsters') ? ' in' : '') + (cur === 'monsters' ? ' now' : '')}>
              <span className="lbl">👹 몬스터 벌점</span>
              <span className="val confirmed">{(confirmed?.monsters ?? detail.monsterCells.length) ? `−${confirmed?.monsters ?? detail.monsterCells.length}` : '0'}</span>
              <small>몬스터와 맞닿은 빈칸(겹쳐도 한 번만)</small>
            </div>
            <div className={'ov-line total' + (shown('total') ? ' in' : '')}>
              <span className="lbl">이번 계절</span>
              <span className="val confirmed">{confirmed?.total ?? detail.total}점</span>
              <small>누적 {rows.find((r) => r.seat === focus)?.total ?? 0}점</small>
            </div>
            {shown('ranking') && (
              <table className="rank-table">
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>이름</th>
                    <th>이번 계절</th>
                    <th>누적</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = memberAtSeat(room, r.seat);
                    const d = r.rankBefore - r.rank;
                    return (
                      <tr key={r.seat} className={r.seat === youSeat ? 'you' : ''}>
                        <td>
                          {r.rank}위{' '}
                          {season > 0 && d !== 0 && (
                            <span className={'rank-delta ' + (d > 0 ? 'up' : 'down')} aria-label={d > 0 ? `${d}계단 상승` : `${-d}계단 하락`}>
                              {d > 0 ? `▲${d}` : `▼${-d}`}
                            </span>
                          )}
                        </td>
                        <td>
                          {displayName(m)} {m?.kind === 'bot' && <span className="badge badge-bot">봇</span>}
                        </td>
                        <td className="num">{r.season >= 0 ? '+' : ''}{r.season}</td>
                        <td className="num strong">{r.total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <footer className="ov-foot">
          {over ? (
            <button type="button" className="btn primary big" onClick={onClose}>
              최종 결과 보기
            </button>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={onClose}>
                지도 다시 보기
              </button>
              <button type="button" className="btn primary big" disabled={ready || youSeat < 0} onClick={onReady}>
                {ready ? '준비 완료 — 다른 사람을 기다리는 중' : `${SEASON_NAMES[season + 1]} 시작 준비 완료`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
