// 첫 화면: 사용자가 만든 타이틀 일러스트 위, 가운데 양피지 여백에 제목과 버튼을 올린다.

import { useState } from 'react';
import type { BotLevel } from '../../engine/bot';
import { cleanNick, isRoomCode, normalizeCode } from '../../shared/protocol';
import { LocalSession, clearLocalGame, hasLocalGame } from '../net/session';
import { navigate } from '../router';
import { creds, profile } from '../storage';

async function createRoomOnServer(nick: string): Promise<{ code: string } | { error: string }> {
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nick }),
    });
    const data = (await res.json()) as { code?: string; id?: string; secret?: string; error?: string };
    if (!res.ok || !data.code || !data.id || !data.secret) return { error: data.error ?? '방을 만들지 못했습니다.' };
    creds.set(data.code, data.id, data.secret);
    return { code: data.code };
  } catch {
    return { error: '서버에 연결하지 못했습니다. 인터넷 연결을 확인하거나 [혼자 플레이]를 이용하세요.' };
  }
}

export function Title() {
  const [nick, setNick] = useState(profile.nick());
  const [mode, setMode] = useState<'main' | 'join' | 'solo'>('main');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [soloKind, setSoloKind] = useState<'solo' | 'bots'>('solo');
  const [botCount, setBotCount] = useState(2);
  const [botLevel, setBotLevel] = useState<BotLevel>('medium');
  const [mapSide, setMapSide] = useState<'A' | 'B'>('A');
  const [quick, setQuick] = useState(false);
  const [hints, setHints] = useState(true);
  const recent = creds.recent();
  const canResume = hasLocalGame();

  const cleaned = cleanNick(nick);
  const needNick = () => {
    if (!cleaned) {
      setErr('닉네임을 먼저 입력하세요 (최대 12자).');
      return true;
    }
    profile.setNick(cleaned);
    return false;
  };

  const onCreate = async () => {
    setErr(null);
    if (needNick()) return;
    setBusy(true);
    const res = await createRoomOnServer(cleaned);
    setBusy(false);
    if ('error' in res) setErr(res.error);
    else navigate('/r/' + res.code);
  };

  const onJoin = () => {
    setErr(null);
    if (needNick()) return;
    const c = normalizeCode(code);
    if (!isRoomCode(c)) {
      setErr('방 코드는 6글자입니다 (예: K7M2QX).');
      return;
    }
    navigate('/r/' + c);
  };

  const onSolo = () => {
    setErr(null);
    if (needNick()) return;
    clearLocalGame();
    LocalSession.create({
      nick: cleaned,
      bots: soloKind === 'solo' ? [] : Array.from({ length: botCount }, () => botLevel),
      settings: { mapSide, mode: quick ? 'quick' : 'standard', hints, turnSeconds: 0 },
    }).dispose();
    navigate('/play');
  };

  return (
    <div className="title-screen">
      <div className="title-center">
        <h1 className="game-title">사계절의 지도</h1>
        <p className="subtitle">한 장의 지도 위에서 펼쳐지는 네 계절의 작은 세계</p>

        <label className="nick-field">
          <span>닉네임</span>
          <input
            value={nick}
            maxLength={24}
            placeholder="지도사 이름 (최대 12자)"
            onChange={(e) => setNick(e.target.value)}
            autoComplete="nickname"
            aria-describedby="nick-help"
          />
        </label>
        <small id="nick-help" className="help">
          회원가입·이메일·비밀번호 없이 닉네임만으로 시작합니다.
        </small>

        {mode === 'main' && (
          <div className="title-buttons">
            <button type="button" className="btn primary big" disabled={busy} onClick={() => void onCreate()}>
              {busy ? '방을 만드는 중…' : '방 만들기'}
            </button>
            <button type="button" className="btn big" onClick={() => setMode('join')}>
              방 코드로 참가
            </button>
            <button type="button" className="btn big" onClick={() => setMode('solo')}>
              혼자 플레이
            </button>
            <button type="button" className="btn ghost big" onClick={() => navigate('/rules')}>
              규칙 배우기
            </button>
            {canResume && (
              <button type="button" className="btn ghost" onClick={() => navigate('/play')}>
                ↺ 혼자 하던 게임 이어하기
              </button>
            )}
          </div>
        )}

        {mode === 'join' && (
          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              onJoin();
            }}
          >
            <label>
              <span>방 코드</span>
              <input value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="예: K7M2QX" inputMode="text" autoCapitalize="characters" className="code-input" aria-label="방 코드" />
            </label>
            <div className="row-buttons">
              <button type="submit" className="btn primary">
                참가하기
              </button>
              <button type="button" className="btn ghost" onClick={() => setMode('main')}>
                뒤로
              </button>
            </div>
          </form>
        )}

        {mode === 'solo' && (
          <div className="solo-setup">
            <div className="seg" role="radiogroup" aria-label="혼자 플레이 방식">
              <button type="button" role="radio" aria-checked={soloKind === 'solo'} className={'seg-btn' + (soloKind === 'solo' ? ' on' : '')} onClick={() => setSoloKind('solo')}>
                🧭 솔로 도전
              </button>
              <button type="button" role="radio" aria-checked={soloKind === 'bots'} className={'seg-btn' + (soloKind === 'bots' ? ' on' : '')} onClick={() => setSoloKind('bots')}>
                🤖 봇 대전
              </button>
            </div>
            <p className="help">
              {soloKind === 'solo'
                ? '원작 솔로 규칙(매복은 모서리에서 자동으로)으로 혼자 완주하고, 이 기기에 저장된 최고 기록과 비교합니다.'
                : '멀티플레이와 같은 규칙으로 봇 1~3명과 겨룹니다. 봇은 이름 옆에 🤖 표시가 붙습니다.'}
            </p>
            {soloKind === 'bots' && (
              <div className="setting-row">
                <span>봇 수</span>
                <div className="seg small">
                  {[1, 2, 3].map((n) => (
                    <button type="button" key={n} className={'seg-btn' + (botCount === n ? ' on' : '')} onClick={() => setBotCount(n)}>
                      {n}명
                    </button>
                  ))}
                </div>
                <span>난이도</span>
                <div className="seg small">
                  <button type="button" className={'seg-btn' + (botLevel === 'easy' ? ' on' : '')} onClick={() => setBotLevel('easy')}>
                    초급
                  </button>
                  <button type="button" className={'seg-btn' + (botLevel === 'medium' ? ' on' : '')} onClick={() => setBotLevel('medium')}>
                    중급
                  </button>
                </div>
              </div>
            )}
            <div className="setting-row">
              <span>지도</span>
              <div className="seg small">
                <button type="button" className={'seg-btn' + (mapSide === 'A' ? ' on' : '')} onClick={() => setMapSide('A')}>
                  A 야생지
                </button>
                <button type="button" className={'seg-btn' + (mapSide === 'B' ? ' on' : '')} onClick={() => setMapSide('B')}>
                  B 황무지
                </button>
              </div>
            </div>
            <div className="setting-row">
              <label className="check">
                <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> 빠른 모드 <span className="badge badge-custom">커스텀</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} /> 점수 예측 도움말
              </label>
            </div>
            <div className="row-buttons">
              <button type="button" className="btn primary big" onClick={onSolo}>
                시작하기
              </button>
              <button type="button" className="btn ghost" onClick={() => setMode('main')}>
                뒤로
              </button>
            </div>
          </div>
        )}

        {err && (
          <p className="error-line" role="alert">
            {err}
          </p>
        )}

        {recent.length > 0 && mode === 'main' && (
          <div className="recent-rooms">
            <small>최근 방:</small>
            {recent.map((c) => (
              <button type="button" key={c} className="chip link" onClick={() => navigate('/r/' + c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="title-foot">
        비공식 팬 제작 온라인 구현 · 원작 규칙 기반 + 커스텀 카드 표시 ·{' '}
        <a
          href="/rules#privacy"
          onClick={(e) => {
            e.preventDefault();
            navigate('/rules#privacy');
          }}
        >
          보관 기간 안내
        </a>
      </footer>
    </div>
  );
}
