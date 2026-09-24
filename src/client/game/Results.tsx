// 게임 종료: 최종 순위, 점수 내역, 지도 갤러리, PNG 저장, 지도 성장 다시 보기, 재경기.

import { useEffect, useMemo, useState } from 'react';
import { cardName } from '../../engine/cards';
import { SEASON_NAMES } from '../../engine/game';
import { MAPS, initialBoard } from '../../engine/maps';
import { TERRAIN_CHAR, type PlacementLog } from '../../engine/types';
import type { GameView, RoomView } from '../../room/types';
import type { Session, Snapshot } from '../net/session';
import { BoardSvg } from './Board';
import { exportMapPng } from './exportPng';
import { displayName, memberAtSeat } from './model';
import { addRecord, allRecords, configKey, customTitle } from './soloRecords';

function boardAt(game: GameView, logs: PlacementLog[], k: number): string {
  const arr = initialBoard(MAPS[game.mapSide]).split('');
  for (const l of logs.slice(0, k)) for (const i of l.cells) arr[i] = TERRAIN_CHAR[l.terrain];
  return arr.join('');
}

const KIND_LABEL: Record<PlacementLog['kind'], string> = {
  draw: '그리기',
  fallback: '1칸 대체',
  ambush: '매복 몬스터',
  'solo-ambush': '솔로 매복',
};

function Replay({ room, game, seat }: { room: RoomView; game: GameView; seat: number }) {
  const logs = game.logs?.[seat] ?? [];
  const [k, setK] = useState(logs.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setK(logs.length);
    setPlaying(false);
  }, [seat, logs.length]);
  useEffect(() => {
    if (!playing) return;
    if (k >= logs.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setK((x) => x + 1), 650);
    return () => clearTimeout(t);
  }, [playing, k, logs.length]);
  const board = useMemo(() => boardAt(game, logs, k), [game, logs, k]);
  const last = k > 0 ? logs[k - 1] : null;
  const who = last && last.by >= 0 && last.by !== seat ? displayName(memberAtSeat(room, last.by)) : null;
  return (
    <div className="replay">
      <div className="replay-board">
        <BoardSvg board={board} mapSide={game.mapSide} fresh={last?.cells} suffix="-rp" />
      </div>
      <div className="replay-controls">
        <button
          type="button"
          className="btn small"
          onClick={() => {
            if (k >= logs.length) setK(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? '⏸ 멈춤' : '▶ 재생'}
        </button>
        <input type="range" min={0} max={logs.length} value={k} onChange={(e) => { setPlaying(false); setK(Number(e.target.value)); }} aria-label="다시 보기 위치" />
        <span className="replay-step">
          {k}/{logs.length}
        </span>
      </div>
      <p className="replay-caption">
        {last
          ? `${SEASON_NAMES[last.season]} · ${cardName(last.card)} · ${KIND_LABEL[last.kind]}${who ? ` (${who}님이 그림)` : ''}${last.auto === 'timeout' ? ' · 시간 초과 자동' : last.auto === 'proxy' ? ' · 임시 봇' : ''}`
          : '빈 지도에서 시작'}
      </p>
    </div>
  );
}

function SoloPanel({ game, finishedAt }: { game: GameView; finishedAt: number | null }) {
  const p = game.players[0];
  const rec = useMemo(
    () => ({
      at: finishedAt ?? Date.now(),
      gameKey: `${game.rules}:${game.no}:${finishedAt}`,
      score: p.total,
      rules: game.rules,
      mapSide: game.mapSide,
      mode: game.mode,
      objectives: [...game.objectives],
    }),
    [game, p.total, finishedAt],
  );
  const [records, setRecords] = useState(() => allRecords());
  useEffect(() => {
    setRecords(addRecord(rec));
  }, [rec]);
  const same = records.filter((r) => configKey(r) === configKey(rec) && r.gameKey !== rec.gameKey);
  const sameRules = records.filter((r) => r.rules === rec.rules && r.mapSide === rec.mapSide && r.mode === rec.mode && r.gameKey !== rec.gameKey);
  const bestSame = same.length ? Math.max(...same.map((r) => r.score)) : null;
  const bestAll = sameRules.length ? Math.max(...sameRules.map((r) => r.score)) : null;
  return (
    <div className="solo-panel">
      <h3>솔로 도전 기록</h3>
      <p className="solo-title">
        <b>{customTitle(p.total)}</b> <span className="badge badge-custom">커스텀 칭호</span>
      </p>
      <p className="note">원작의 솔로 평가 등급은 목표 카드별 보정치가 필요한데 공식 자료에서 확인하지 못해 적용하지 않았습니다. 이 칭호는 이 앱의 자체 기준입니다.</p>
      <ul>
        <li>
          이번 기록: <b>{p.total}점</b>
        </li>
        <li>
          같은 목표 구성 최고 기록: {bestSame === null ? '처음 도전' : `${bestSame}점 ${p.total > bestSame ? '→ 🎉 새 최고 기록!' : ''}`}
        </li>
        <li>
          같은 지도·모드 전체 최고 기록: {bestAll === null ? '없음' : `${bestAll}점`}
        </li>
      </ul>
      <p className="note">기록은 이 기기(브라우저)에만 저장됩니다.</p>
    </div>
  );
}

export function Results({ session, snap, onLeave }: { session: Session; snap: Snapshot; onLeave: () => void }) {
  const room = snap.room!;
  const game = room.game!;
  const standings = game.standings ?? [];
  const youSeat = room.you?.seat ?? -1;
  const [sel, setSel] = useState(youSeat >= 0 ? youSeat : standings[0]?.seat ?? 0);
  const [busy, setBusy] = useState(false);
  const winners = standings.filter((s) => s.rank === 1);
  const tieByMonsters = standings.length > 1 && standings[0].total === standings[1].total && standings[0].rank !== standings[1].rank;

  const savePng = async (seat: number) => {
    setBusy(true);
    const st = standings.find((s) => s.seat === seat);
    await exportMapPng({
      board: game.players[seat].board,
      mapSide: game.mapSide,
      name: displayName(memberAtSeat(room, seat)),
      total: game.players[seat].total,
      rank: game.solo ? null : st?.rank ?? null,
      seasons: game.players[seat].seasons,
    });
    setBusy(false);
  };

  return (
    <div className="results-screen">
      <header className="results-head">
        <h1>지도 완성!</h1>
        {!game.solo && (
          <p className="winner">
            🏆 {winners.map((w) => displayName(memberAtSeat(room, w.seat))).join(', ')} {winners.length > 1 ? '공동 우승' : '우승'}
            {tieByMonsters && <small> (동점 → 몬스터로 잃은 점수가 적은 사람이 앞섭니다)</small>}
          </p>
        )}
      </header>

      <section className="results-table">
        <table>
          <thead>
            <tr>
              {!game.solo && <th>순위</th>}
              <th>지도사</th>
              {SEASON_NAMES.map((s) => (
                <th key={s}>{s}</th>
              ))}
              <th>몬스터 벌점</th>
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((st) => {
              const m = memberAtSeat(room, st.seat);
              const p = game.players[st.seat];
              return (
                <tr key={st.seat} className={st.seat === youSeat ? 'you' : ''} onClick={() => setSel(st.seat)}>
                  {!game.solo && <td>{st.rank}위</td>}
                  <td>
                    {displayName(m)} {m?.kind === 'bot' && <span className="badge badge-bot">🤖 봇</span>}
                  </td>
                  {p.seasons.map((s) => (
                    <td key={s.season} className="num" title={`목표 ${s.points[0]}+${s.points[1]}, 코인 ${s.coins}, 몬스터 −${s.monsters}`}>
                      {s.total}
                    </td>
                  ))}
                  <td className="num">−{st.monsters}</td>
                  <td className="num strong">{st.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {game.solo && <SoloPanel game={game} finishedAt={room.finishedAt} />}

      <section className="results-main">
        <div className="gallery" aria-label="참가자 지도 갤러리">
          {standings.map((st) => (
            <button type="button" key={st.seat} className={'gallery-item' + (sel === st.seat ? ' on' : '')} onClick={() => setSel(st.seat)}>
              <BoardSvg board={game.players[st.seat].board} mapSide={game.mapSide} labels={false} suffix={'-g' + st.seat} />
              <span>
                {displayName(memberAtSeat(room, st.seat))} · {st.total}점
              </span>
            </button>
          ))}
        </div>
        <div className="replay-wrap">
          <h3>{displayName(memberAtSeat(room, sel))}님의 지도 성장 다시 보기</h3>
          <Replay room={room} game={game} seat={sel} />
          <div className="row-buttons">
            {youSeat >= 0 && (
              <button type="button" className="btn" disabled={busy} onClick={() => void savePng(youSeat)}>
                🖼 내 지도 PNG 저장
              </button>
            )}
            {sel !== youSeat && (
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void savePng(sel)}>
                이 지도 PNG 저장
              </button>
            )}
          </div>
        </div>
      </section>

      <footer className="results-foot">
        {room.you?.isHost && (
          <>
            <button type="button" className="btn primary big" onClick={() => void session.send({ a: 'rematch' })}>
              같은 참가자로 다시 하기
            </button>
            {!room.local && (
              <button type="button" className="btn" onClick={() => void session.send({ a: 'toLobby' })}>
                대기실로 (설정 바꾸기)
              </button>
            )}
          </>
        )}
        {!room.you?.isHost && !room.local && <p className="note">방장이 재경기를 시작하면 자동으로 이어집니다.</p>}
        <button type="button" className="btn ghost" onClick={onLeave}>
          처음 화면으로
        </button>
        {!room.local && <p className="note">결과는 게임이 끝난 뒤 24시간 동안 이 방 링크에서 다시 볼 수 있고, 그 뒤 자동으로 지워집니다.</p>}
      </footer>
    </div>
  );
}
