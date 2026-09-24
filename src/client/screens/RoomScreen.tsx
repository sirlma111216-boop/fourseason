// /r/:code — 방 입장(닉네임) → 대기실 → 게임 → 결과. 만료된 링크는 안내 화면.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { cleanNick } from '../../shared/protocol';
import { GameScreen } from '../game/GameScreen';
import { LocalSession, OnlineSession, clearLocalGame, type Session } from '../net/session';
import { navigate } from '../router';
import { creds, profile } from '../storage';
import { Lobby } from './Lobby';

type RoomStatus = 'checking' | 'none' | 'expired' | 'lobby' | 'playing' | 'finished' | 'offline';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="plain-screen">
      <div className="plain-card">{children}</div>
    </div>
  );
}

export function FatalScreen({ code, message }: { code: string; message: string }) {
  const title =
    code === 'expired'
      ? '보관 기간이 지난 방입니다'
      : code === 'not-found' || code === 'none'
        ? '없는 방 코드입니다'
        : code === 'replaced'
          ? '다른 탭에서 이 자리로 접속했습니다'
          : code === 'kicked'
            ? '방에서 나왔습니다'
            : '연결할 수 없습니다';
  return (
    <Centered>
      <h1>{title}</h1>
      <p>{message}</p>
      {code === 'expired' && <p className="note">끝난 게임의 결과는 24시간, 활동이 없는 방은 마지막 활동 후 24시간 동안만 보관됩니다.</p>}
      <div className="row-buttons">
        {code === 'replaced' && (
          <button type="button" className="btn primary" onClick={() => location.reload()}>
            이 탭에서 다시 접속
          </button>
        )}
        <button type="button" className="btn" onClick={() => navigate('/')}>
          처음 화면으로
        </button>
      </div>
    </Centered>
  );
}

function JoinForm({ code, status, onJoin }: { code: string; status: RoomStatus; onJoin: (nick: string) => void }) {
  const [nick, setNick] = useState(profile.nick());
  const [err, setErr] = useState<string | null>(null);
  return (
    <Centered>
      <h1>방 {code}에 참가</h1>
      {status === 'playing' && <p>이미 게임이 진행 중입니다. 지금 들어오면 <b>관전</b>으로 참가합니다.</p>}
      {status === 'finished' && <p>게임이 끝난 방입니다. 결과를 볼 수 있어요.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = cleanNick(nick);
          if (!n) {
            setErr('닉네임을 입력하세요.');
            return;
          }
          onJoin(n);
        }}
      >
        <label className="nick-field">
          <span>닉네임</span>
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={24} autoFocus placeholder="지도사 이름" />
        </label>
        <p className="help">닉네임은 화면에 보이는 이름일 뿐 로그인이 아닙니다. 같은 이름이 있으면 #2처럼 번호가 붙어요.</p>
        <div className="row-buttons">
          <button type="submit" className="btn primary big">
            {status === 'lobby' ? '참가하기' : '입장하기'}
          </button>
          <button type="button" className="btn ghost" onClick={() => navigate('/')}>
            처음 화면으로
          </button>
        </div>
        {err && <p className="error-line">{err}</p>}
      </form>
    </Centered>
  );
}

const noop = () => () => {};
const nullSnap = () => null;

function useSnapshot(session: Session | null) {
  return useSyncExternalStore(session ? session.subscribe : noop, session ? session.getSnapshot : nullSnap);
}

export function SessionView({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const snap = useSnapshot(session)!;
  if (snap.fatal) return <FatalScreen code={snap.fatal.code} message={snap.fatal.message} />;
  if (snap.needNick)
    return (
      <JoinForm
        code={snap.code}
        status="lobby"
        onJoin={(n) => {
          session.join?.(n);
        }}
      />
    );
  if (!snap.room)
    return (
      <Centered>
        <p className="loading">지도를 펼치는 중…</p>
      </Centered>
    );
  if (snap.room.status === 'lobby') return <Lobby room={snap.room} session={session} onLeave={onLeave} />;
  return <GameScreen session={session} snap={snap} onLeave={onLeave} />;
}

export function RoomScreen({ code }: { code: string }) {
  const [status, setStatus] = useState<RoomStatus>('checking');
  const [session, setSession] = useState<OnlineSession | null>(null);
  const hasCreds = !!creds.get(code);

  useEffect(() => {
    let alive = true;
    fetch('/api/rooms/' + code)
      .then(async (r) => (r.ok || r.status === 404 ? ((await r.json()) as { status: RoomStatus }) : { status: 'offline' as RoomStatus }))
      .then((d) => alive && setStatus(d.status))
      .catch(() => alive && setStatus('offline'));
    return () => {
      alive = false;
    };
  }, [code]);

  useEffect(() => {
    if (!session) return;
    return () => session.dispose();
  }, [session]);

  // 복귀 정보가 있으면 바로 붙는다
  useEffect(() => {
    if (session || !hasCreds) return;
    if (status === 'lobby' || status === 'playing' || status === 'finished' || status === 'offline') setSession(new OnlineSession(code));
  }, [status, hasCreds, session, code]);

  if (status === 'checking') return <Centered><p className="loading">방을 찾는 중…</p></Centered>;
  if (status === 'none' || status === 'expired') {
    if (status === 'expired' || status === 'none') creds.clear(code);
    return <FatalScreen code={status} message={status === 'expired' ? '이 방은 보관 기간이 지나 정리되었습니다. 새 방을 만들어 주세요.' : '코드를 다시 확인하거나 새 방을 만들어 주세요.'} />;
  }
  if (!session) {
    if (status === 'offline') return <FatalScreen code="offline" message="서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요. 혼자 하기는 처음 화면의 [혼자 플레이]로 오프라인에서도 할 수 있어요." />;
    return (
      <JoinForm
        code={code}
        status={status}
        onJoin={(n) => {
          profile.setNick(n);
          setSession(new OnlineSession(code));
        }}
      />
    );
  }
  return <SessionView session={session} onLeave={() => navigate('/')} />;
}

export function PlayScreen() {
  const [session] = useState(() => LocalSession.resume());
  useEffect(() => () => session?.dispose(), [session]);
  if (!session)
    return (
      <Centered>
        <h1>진행 중인 혼자 하기 게임이 없습니다</h1>
        <button type="button" className="btn primary" onClick={() => navigate('/')}>
          처음 화면으로
        </button>
      </Centered>
    );
  return (
    <SessionView
      session={session}
      onLeave={() => {
        const over = session.getSnapshot().room?.status === 'finished';
        if (over) clearLocalGame();
        else if (!confirm('처음 화면으로 갈까요? 진행 상황은 이 기기에 저장되어 [이어하기]로 돌아올 수 있습니다.')) return;
        navigate('/');
      }}
    />
  );
}
