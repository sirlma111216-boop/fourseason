import { useEffect } from 'react';
import { isRoomCode, normalizeCode } from '../shared/protocol';
import { usePath, navigate } from './router';
import { PlayScreen, RoomScreen } from './screens/RoomScreen';
import { Rules } from './screens/Rules';
import { Title } from './screens/Title';
import { Tutorial } from './screens/Tutorial';

export function App() {
  const path = usePath();
  useEffect(() => {
    document.body.dataset.route = path.split('/')[1] || 'title';
  }, [path]);

  if (path === '/' || path === '') return <Title />;
  if (path === '/rules') return <Rules />;
  if (path === '/tutorial') return <Tutorial />;
  if (path === '/play') return <PlayScreen />;
  const m = path.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  if (m) {
    const code = normalizeCode(m[1]);
    if (isRoomCode(code)) return <RoomScreen key={code} code={code} />;
  }
  return (
    <div className="plain-screen">
      <div className="plain-card">
        <h1>페이지를 찾을 수 없어요</h1>
        <button type="button" className="btn primary" onClick={() => navigate('/')}>
          처음 화면으로
        </button>
      </div>
    </div>
  );
}
