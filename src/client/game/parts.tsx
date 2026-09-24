// 게임 화면의 작은 부품들: 모양 그림, 카드, 계절 진행, 목표, 참가자.

import { useEffect, useMemo, useState } from 'react';
import { ambushCard, cardName, cardSource, exploreCard } from '../../engine/cards';
import { EDICT_LETTERS, SEASON_EDICTS, SEASON_NAMES, ruinsOf } from '../../engine/game';
import { CATEGORY_LABEL, objective, type ObjectiveResult } from '../../engine/objectives';
import { transform } from '../../engine/shapes';
import type { DrawTerrain, ShapeCells } from '../../engine/types';
import type { GameView, RoomView } from '../../room/types';
import { EMOTE_LABEL, type Emote } from '../../shared/protocol';
import { BoardSvg } from './Board';
import { displayName, memberAtSeat } from './model';
import { TERRAIN_META, TerrainIcon } from './terrain';

export function ShapeGlyph({ cells, t = 0, size = 44, color = '#6b5640', coin = false }: { cells: ShapeCells; t?: number; size?: number; color?: string; coin?: boolean }) {
  const v = transform(cells, t);
  const h = Math.max(...v.map((c) => c[0])) + 1;
  const w = Math.max(...v.map((c) => c[1])) + 1;
  const dim = Math.max(h, w, 2);
  return (
    <svg width={size} height={size} viewBox={`-0.15 -0.15 ${dim + 0.3} ${dim + 0.3}`} aria-hidden="true">
      <g transform={`translate(${(dim - w) / 2} ${(dim - h) / 2})`}>
        {v.map(([r, c]) => (
          <rect key={r + ',' + c} x={c + 0.05} y={r + 0.05} width={0.9} height={0.9} rx="0.12" fill={color} stroke="#3b2a1a" strokeWidth="0.06" />
        ))}
      </g>
      {coin && (
        <g transform={`translate(${dim - 0.25} ${dim - 0.25})`}>
          <circle r="0.32" fill="#e8b93a" stroke="#8a6414" strokeWidth="0.07" />
        </g>
      )}
    </svg>
  );
}

export function SourceBadge({ id }: { id: string }) {
  const src = cardSource(id);
  if (src !== 'custom') return null;
  return (
    <span className="badge badge-custom" title="공식 자료에서 앞면을 확인할 수 없어 이 앱이 새로 만든 카드입니다">
      커스텀
    </span>
  );
}

export function CardFace({ id, compact = false }: { id: string; compact?: boolean }) {
  const ex = exploreCard(id);
  const am = ambushCard(id);
  if (am) {
    return (
      <div className={'card card-ambush' + (compact ? ' compact' : '')}>
        <div className="card-head">
          <span className="card-kind">매복</span>
          <strong>{am.name}</strong>
          <SourceBadge id={id} />
        </div>
        <div className="card-body">
          <ShapeGlyph cells={am.cells} color={TERRAIN_META.monster.color} size={compact ? 34 : 54} />
          <span className="dir">{am.direction === 'cw' ? '↻ 시계 방향' : '↺ 반시계 방향'}</span>
        </div>
      </div>
    );
  }
  if (!ex) return null;
  return (
    <div className={'card card-' + ex.kind + (compact ? ' compact' : '')}>
      <div className="card-head">
        <span className="time" title="시간 값">
          ⏳{ex.time}
        </span>
        <strong>{ex.name}</strong>
        <SourceBadge id={id} />
      </div>
      {ex.kind === 'ruins' ? (
        <div className="card-body ruins-note">
          <TerrainIcon kind="ruins" size={compact ? 26 : 36} /> 다음 탐험 카드의 모양으로 <b>폐허 칸을 덮어야</b> 합니다
        </div>
      ) : (
        <div className="card-body">
          <div className="terrains">
            {ex.terrains.map((t) => (
              <TerrainIcon key={t} kind={t} size={compact ? 22 : 28} />
            ))}
          </div>
          <div className="shapes">
            {ex.shapes.map((s, i) => (
              <ShapeGlyph key={i} cells={s.cells} coin={s.coin} size={compact ? 30 : 44} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SeasonTrack({ game }: { game: GameView }) {
  return (
    <div className="season-track" aria-label="계절 진행">
      {SEASON_NAMES.map((name, s) => {
        const cur = s === game.season;
        const done = s < game.season || (s === game.season && (game.phase === 'seasonEnd' || game.phase === 'gameOver'));
        const [a, b] = SEASON_EDICTS[s];
        return (
          <div key={s} className={'season season-' + s + (cur ? ' current' : '') + (done ? ' done' : '')}>
            <div className="season-name">
              {name} <small>{EDICT_LETTERS[a] + EDICT_LETTERS[b]}</small>
            </div>
            {cur ? (
              <div className="time-bar" role="progressbar" aria-valuemin={0} aria-valuemax={game.threshold} aria-valuenow={game.timeUsed} aria-label={`${name} 시간 ${game.timeUsed}/${game.threshold}`}>
                {Array.from({ length: game.threshold }, (_, i) => (
                  <span key={i} className={i < game.timeUsed ? 'on' : ''} />
                ))}
                <em>
                  {Math.min(game.timeUsed, game.threshold)}/{game.threshold}
                </em>
              </div>
            ) : (
              <div className="time-mini">⏳{game.thresholds[s]}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useNow(skew = 0, interval = 250): number {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skew), interval);
    return () => clearInterval(t);
  }, [skew, interval]);
  return now;
}

export function Countdown({ deadline, skew, label = '남은 시간' }: { deadline: number | null; skew: number; label?: string }) {
  const now = useNow(skew);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className={'countdown' + (left <= 10 ? ' urgent' : '')} aria-live="polite">
      ⏱ {label} {left}초
    </span>
  );
}

export interface ObjectivePrediction {
  current: ObjectiveResult;
  predicted: ObjectiveResult | null;
}

export function ObjectiveList({
  game,
  board,
  draftBoard,
  hints,
  selected,
  onSelect,
}: {
  game: GameView;
  board: string | null;
  draftBoard: string | null;
  hints: boolean;
  selected: number | null;
  onSelect: (slot: number | null) => void;
}) {
  const ruins = ruinsOf(game);
  const active = SEASON_EDICTS[Math.min(game.season, 3)];
  const results = useMemo(
    () =>
      game.objectives.map((id) => {
        const o = objective(id);
        const current = board ? o.score({ board, ruins }) : null;
        const predicted = draftBoard ? o.score({ board: draftBoard, ruins }) : null;
        return { o, current, predicted };
      }),
    [game.objectives, board, draftBoard, ruins],
  );
  return (
    <div className="objectives">
      {results.map(({ o, current, predicted }, slot) => {
        const isActive = active.includes(slot) && game.phase !== 'gameOver';
        const delta = predicted && current ? predicted.points - current.points : 0;
        return (
          <button
            type="button"
            key={o.id}
            className={'objective cat-' + o.category + (isActive ? ' active' : '') + (selected === slot ? ' selected' : '')}
            onClick={() => onSelect(selected === slot ? null : slot)}
            aria-pressed={selected === slot}
          >
            <div className="obj-head">
              <span className="letter">{EDICT_LETTERS[slot]}</span>
              <strong>{o.name}</strong>
              <span className="cat">{CATEGORY_LABEL[o.category]}</span>
            </div>
            <p className="obj-rule">{o.rule}</p>
            {hints && current && (
              <div className="obj-score">
                <span className="now" title="지금 지도 기준 점수(예상)">
                  지금 {current.points}점
                </span>
                {predicted && delta !== 0 && (
                  <span className={'delta ' + (delta > 0 ? 'up' : 'down')} title="이 배치를 확정하면 바뀌는 예상 점수">
                    예상 {delta > 0 ? '+' : ''}
                    {delta}
                  </span>
                )}
                {isActive && <span className="this-season">이번 계절 채점</span>}
              </div>
            )}
            {!hints && isActive && <div className="obj-score"><span className="this-season">이번 계절 채점</span></div>}
          </button>
        );
      })}
    </div>
  );
}

/** 감정 표현 말풍선(받은 뒤 4초 동안). at 은 이 기기에서 받은 시각이다. */
export function EmoteBubbles({ emotes, memberId }: { emotes: { uid: string; from: string; key: string; at: number }[]; memberId: string }) {
  const now = useNow(0, 500);
  const mine = emotes.filter((e) => e.from === memberId && now - e.at < 4000);
  const last = mine[mine.length - 1];
  if (!last) return null;
  const meta = EMOTE_LABEL[last.key as Emote];
  if (!meta) return null;
  return (
    <span className="emote-bubble" key={last.uid} aria-live="polite">
      {meta.icon}
    </span>
  );
}

export function PlayerList({
  room,
  game,
  youId,
  emotes,
  onView,
  highlightSeat,
}: {
  room: RoomView;
  game: GameView;
  youId: string | null;
  emotes: { uid: string; from: string; key: string; at: number }[];
  onView: (seat: number) => void;
  highlightSeat?: number | null;
}) {
  const turn = game.turn;
  return (
    <ul className="players">
      {game.players.map((p, seat) => {
        const m = memberAtSeat(room, seat);
        const done = turn?.submitted[seat];
        const isYou = m?.id === youId;
        const target = turn?.kind === 'ambush' ? turn.targets[seat] : null;
        return (
          <li key={seat} className={'player' + (isYou ? ' you' : '') + (highlightSeat === seat ? ' hl' : '')}>
            <button type="button" className="player-thumb" onClick={() => onView(seat)} aria-label={`${displayName(m)}의 지도 보기`}>
              <BoardSvg board={p.board} mapSide={game.mapSide} labels={false} suffix={'-t' + seat} />
            </button>
            <div className="player-info">
              <div className="player-name">
                <span className={'dot ' + (m?.kind === 'bot' || m?.connected ? 'on' : 'off')} aria-hidden="true" />
                <span className="nm">{displayName(m)}</span>
                {m?.kind === 'bot' && <span className="badge badge-bot">🤖 봇</span>}
                {m?.proxy && <span className="badge badge-proxy">대리</span>}
                {m?.isHost && <span className="badge badge-host" title="방장">👑</span>}
                {isYou && <span className="badge badge-you">나</span>}
                {m && <EmoteBubbles emotes={emotes} memberId={m.id} />}
              </div>
              <div className="player-meta">
                <span className="score">★ {p.total}</span>
                <span className="coins">🪙 {p.coins}</span>
                {turn && (
                  <span className={'status ' + (done ? 'done' : 'thinking')}>
                    {done ? '✓ 확정' : m?.kind === 'bot' ? '🤖 계산 중' : m?.proxy ? '대리 진행 중' : m?.connected ? '고민 중' : '연결 끊김'}
                  </span>
                )}
                {target !== null && target !== undefined && (
                  <span className="target">→ {displayName(memberAtSeat(room, target))}의 지도</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TerrainButtons({
  terrains,
  value,
  onChange,
}: {
  terrains: DrawTerrain[];
  value: DrawTerrain;
  onChange: (t: DrawTerrain) => void;
}) {
  return (
    <div className="seg terrain-seg" role="radiogroup" aria-label="지형 선택">
      {terrains.map((t, i) => (
        <button
          type="button"
          key={t}
          role="radio"
          aria-checked={value === t}
          className={'seg-btn' + (value === t ? ' on' : '')}
          onClick={() => onChange(t)}
          title={`${TERRAIN_META[t].label} (단축키 ${'QWERT'[i]})`}
        >
          <TerrainIcon kind={t} size={26} />
          <span>{TERRAIN_META[t].label}</span>
        </button>
      ))}
    </div>
  );
}

export function cardTitle(id: string): string {
  return cardName(id);
}
