// 대기실: 초대 코드·링크, 자리(최대 8, 봇 포함), 준비, 방장 설정.

import { useState } from 'react';
import { BOT_LEVEL_LABEL } from '../../engine/bot';
import { SEASON_THRESHOLDS } from '../../engine/game';
import type { MemberView, RoomView } from '../../room/types';
import { cleanNick, type RoomSettings } from '../../shared/protocol';
import { displayName } from '../game/model';
import type { Session } from '../net/session';

function Seg<T extends string | number | boolean>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { v: T; label: string; badge?: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="seg small" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.v)} role="radio" aria-checked={value === o.v} className={'seg-btn' + (value === o.v ? ' on' : '')} disabled={disabled} onClick={() => onChange(o.v)}>
          {o.label}
          {o.badge && <span className="badge badge-custom">{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Lobby({ room, session, onLeave }: { room: RoomView; session: Session; onLeave: () => void }) {
  const you = room.you;
  const isHost = !!you?.isHost;
  const me = room.members.find((m) => m.id === you?.id);
  const players = room.members.filter((m) => m.role === 'player');
  const spectators = room.members.filter((m) => m.role === 'spectator');
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editNick, setEditNick] = useState(false);
  const [nick, setNick] = useState(me?.nick ?? '');
  const link = `${location.origin}/r/${room.code}`;
  const notReady = players.filter((m) => m.kind === 'human' && !m.isHost && m.connected && !m.ready);

  const run = async (p: Promise<{ ok: boolean; err?: string }>) => {
    setErr(null);
    const r = await p;
    if (!r.ok) setErr(r.err ?? '처리하지 못했습니다');
  };
  const set = (s: Partial<RoomSettings>) => void run(session.send({ a: 'settings', settings: s }));
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied('복사하지 못했습니다. 직접 선택해 복사하세요.');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: '사계절의 지도', text: `방 코드 ${room.code}로 들어와!`, url: link });
      } catch {
        /* 취소 */
      }
    } else await copy(link, '링크');
  };

  const seatRow = (m: MemberView | undefined, i: number) => {
    if (!m)
      return (
        <li key={'empty' + i} className="seat empty">
          <span className="seat-no">{i + 1}</span> 빈 자리
        </li>
      );
    return (
      <li key={m.id} className={'seat' + (m.id === you?.id ? ' you' : '')}>
        <span className="seat-no">{i + 1}</span>
        <span className={'dot ' + (m.kind === 'bot' || m.connected ? 'on' : 'off')} aria-label={m.kind === 'bot' || m.connected ? '접속 중' : '연결 끊김'} />
        <span className="nm">{displayName(m)}</span>
        {m.isHost && <span className="badge badge-host">👑 방장</span>}
        {m.kind === 'bot' && <span className="badge badge-bot">🤖 봇 · {BOT_LEVEL_LABEL[m.botLevel ?? 'medium']}</span>}
        {m.id === you?.id && <span className="badge badge-you">나</span>}
        <span className={'ready ' + (m.ready || m.isHost || m.kind === 'bot' ? 'on' : '')}>{m.kind === 'bot' ? '항상 준비' : m.isHost ? '방장' : m.ready ? '✓ 준비' : '대기'}</span>
        {isHost && m.id !== you?.id && (
          <span className="seat-actions">
            {m.kind === 'bot' ? (
              <button type="button" className="btn tiny" onClick={() => void run(session.send({ a: 'removeBot', memberId: m.id }))}>
                빼기
              </button>
            ) : (
              <>
                <button type="button" className="btn tiny" onClick={() => void run(session.send({ a: 'transferHost', memberId: m.id }))} title="이 사람에게 방장 넘기기">
                  방장 넘기기
                </button>
                <button type="button" className="btn tiny danger" onClick={() => void run(session.send({ a: 'kick', memberId: m.id }))}>
                  내보내기
                </button>
              </>
            )}
          </span>
        )}
      </li>
    );
  };

  const s = room.settings;
  return (
    <div className="lobby-screen">
      <div className="lobby-card">
        <header className="lobby-head">
          <h1>대기실</h1>
          <div className="invite">
            <div className="code-big" aria-label="방 코드">
              {room.code.split('').map((ch, i) => (
                <span key={i}>{ch}</span>
              ))}
            </div>
            <div className="row-buttons">
              <button type="button" className="btn small" onClick={() => void copy(room.code, '코드')}>
                코드 복사
              </button>
              <button type="button" className="btn small" onClick={() => void copy(link, '링크')}>
                링크 복사
              </button>
              <button type="button" className="btn small" onClick={() => void share()}>
                공유
              </button>
            </div>
            {copied && <small className="copied">{copied.length < 4 ? `${copied}를 복사했습니다` : copied}</small>}
          </div>
        </header>

        {room.notice && <div className="banner warn">{room.notice}</div>}
        <section className="lobby-grid">
          <div>
            <h2>
              자리 <small>{players.length}/8 (봇 포함)</small>
            </h2>
            <ol className="seats">{Array.from({ length: 8 }, (_, i) => seatRow(players[i], i))}</ol>
            <p className="note">자리 번호 순서가 시계 방향입니다. 게임이 시작되면 순서가 고정되고, 매복 때 이 순서대로 지도를 넘깁니다.</p>
            {isHost && (
              <div className="row-buttons">
                <button type="button" className="btn small" disabled={players.length >= 8} onClick={() => void run(session.send({ a: 'addBot', level: 'easy' }))}>
                  + 초급 봇
                </button>
                <button type="button" className="btn small" disabled={players.length >= 8} onClick={() => void run(session.send({ a: 'addBot', level: 'medium' }))}>
                  + 중급 봇
                </button>
              </div>
            )}
            {spectators.length > 0 && (
              <>
                <h3>관전</h3>
                <ul className="spectators">
                  {spectators.map((m) => (
                    <li key={m.id}>
                      <span className={'dot ' + (m.connected ? 'on' : 'off')} /> {displayName(m)} {m.id === you?.id && <span className="badge badge-you">나</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h2>게임 설정 {!isHost && <small>(방장만 바꿀 수 있어요)</small>}</h2>
            <div className="settings">
              <div className="setting">
                <span>모드</span>
                <Seg
                  label="모드"
                  value={s.mode}
                  disabled={!isHost}
                  onChange={(v) => set({ mode: v })}
                  options={[
                    { v: 'standard', label: `표준 (${SEASON_THRESHOLDS.standard.join('/')})` },
                    { v: 'quick', label: `빠른 (${SEASON_THRESHOLDS.quick.join('/')})`, badge: '커스텀' },
                  ]}
                />
              </div>
              <div className="setting">
                <span>턴 제한 시간</span>
                <Seg
                  label="턴 제한 시간"
                  value={s.turnSeconds}
                  disabled={!isHost}
                  onChange={(v) => set({ turnSeconds: v })}
                  options={[
                    { v: 0, label: '없음' },
                    { v: 60, label: '60초' },
                    { v: 90, label: '90초' },
                  ]}
                />
              </div>
              <div className="setting">
                <span>채점 예측 도움말</span>
                <Seg label="채점 예측 도움말" value={s.hints} disabled={!isHost} onChange={(v) => set({ hints: v })} options={[{ v: true, label: '켜기' }, { v: false, label: '끄기' }]} />
              </div>
              <div className="setting">
                <span>지도</span>
                <Seg label="지도" value={s.mapSide} disabled={!isHost} onChange={(v) => set({ mapSide: v })} options={[{ v: 'A', label: 'A 야생지' }, { v: 'B', label: 'B 황무지' }]} />
              </div>
            </div>
            <p className="note">
              {s.turnSeconds
                ? `시간 제한 방: ${s.turnSeconds}초 안에 확정하지 않으면 서버가 합법적인 배치를 대신 고릅니다(온라인 편의 규칙).`
                : '시간 제한 없음: 연결이 끊긴 사람은 45초 유예 뒤 임시 봇이 대신 둡니다. 방장은 응답 없는 사람을 대리 진행으로 바꿀 수 있어요.'}
            </p>

            <div className="me-box">
              {editNick ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = cleanNick(nick);
                    if (n) void run(session.send({ a: 'nick', nick: n }));
                    setEditNick(false);
                  }}
                >
                  <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={24} aria-label="새 닉네임" />
                  <button type="submit" className="btn small">
                    바꾸기
                  </button>
                </form>
              ) : (
                <button type="button" className="btn ghost small" onClick={() => setEditNick(true)}>
                  닉네임 바꾸기
                </button>
              )}
            </div>

            <div className="start-box">
              {isHost ? (
                <>
                  <button type="button" className="btn primary big" disabled={players.length < 1 || notReady.length > 0} onClick={() => void run(session.send({ a: 'start' }))}>
                    {players.length === 1 ? '혼자 시작하기 (솔로 규칙)' : '게임 시작'}
                  </button>
                  {notReady.length > 0 && <small>준비를 기다리는 중: {notReady.map((m) => displayName(m)).join(', ')}</small>}
                </>
              ) : me?.role === 'player' ? (
                <button type="button" className={'btn big ' + (me.ready ? '' : 'primary')} onClick={() => void run(session.send({ a: 'ready', ready: !me.ready }))}>
                  {me.ready ? '준비 취소' : '준비 완료'}
                </button>
              ) : (
                <p>관전 중입니다. 게임이 시작되면 모든 지도를 볼 수 있어요.</p>
              )}
            </div>
            {err && <p className="error-line">{err}</p>}
          </div>
        </section>

        <footer className="lobby-foot">
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              void session.send({ a: 'leave' });
              onLeave();
            }}
          >
            방 나가기
          </button>
          <small>로그인 없이 닉네임으로만 참가합니다. 이 방은 마지막 활동 후 24시간(게임 종료 후 24시간)이 지나면 자동으로 지워집니다.</small>
        </footer>
      </div>
    </div>
  );
}
