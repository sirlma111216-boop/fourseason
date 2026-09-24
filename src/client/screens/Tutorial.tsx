// 첫 실행 튜토리얼: 설명만 읽지 않고 직접 해 본다(지형·모양 고르기 → 칸 누르기 → 회전·반전 → 목표 확인 → 확정).

import { useMemo, useState } from 'react';
import { CONTENT_VERSION } from '../../engine/game';
import { MAPS, initialBoard } from '../../engine/maps';
import { objective } from '../../engine/objectives';
import { ruinsMask } from '../../engine/maps';
import { TERRAIN_CHAR } from '../../engine/types';
import type { GameView } from '../../room/types';
import { Board } from '../game/Board';
import { useDraft } from '../game/model';
import { CardFace, ObjectiveList, ShapeGlyph, TerrainButtons } from '../game/parts';
import { TERRAIN_META } from '../game/terrain';
import { navigate } from '../router';
import { profile } from '../storage';

function tutorialGame(board: string): GameView {
  return {
    no: 1,
    rules: CONTENT_VERSION,
    mapSide: 'A',
    mode: 'standard',
    solo: true,
    seatCount: 1,
    objectives: ['edge-forest', 'irrigation', 'capital', 'hollows'],
    season: 0,
    phase: 'draw',
    column: ['orchard-hill'],
    timeUsed: 2,
    threshold: 8,
    thresholds: [8, 8, 7, 6],
    pendingRuins: false,
    removed: [],
    turn: { id: 1, kind: 'draw', card: 'orchard-hill', ruins: false, revealed: ['orchard-hill'], targets: [0], submitted: [false], deadline: null, startedAt: 0, mine: null },
    players: [{ board, coins: 0, mountainCoins: [], seasons: [], total: 0, monsters: 0 }],
    events: [],
    standings: null,
    logs: null,
    seasonReady: [],
    seasonDeadline: null,
  };
}

const STEPS = [
  { title: '① 지형 고르기', text: '이 카드(과수원 언덕)는 숲 또는 농지로 그릴 수 있어요. 아래에서 [농지]를 골라 보세요.' },
  { title: '② 지도에서 칸 누르기', text: '지도의 빈칸을 눌러 모양을 놓아 보세요. 초록 테두리는 놓을 수 있는 자리, 빨간 X는 놓을 수 없는 자리예요. 산(갈색) 위에는 놓을 수 없어요.' },
  { title: '③ 회전과 반전', text: '[⟳ 회전]과 [⇋ 반전]을 한 번씩 눌러 보세요. 키보드는 R, F. 모양이 누른 칸을 중심으로 돌아갑니다.' },
  { title: '④ 목표 확인', text: '목표 카드 B(물길 논밭)를 눌러 보세요. 점수가 나는 칸이 지도에 금색으로 표시되고, 초록 "예상" 숫자는 이 배치를 확정하면 바뀌는 점수예요.' },
  { title: '⑤ 배치 확정', text: '초록 테두리일 때 [배치 확정]을 누르세요. 확정하면 바꿀 수 없어요. 온라인에서는 모두가 확정해야 다음 카드가 열립니다.' },
];

export function Tutorial() {
  const [board, setBoard] = useState(() => {
    // 물 몇 칸을 미리 그려 둔다(목표 예시가 보이게)
    const arr = initialBoard(MAPS.A).split('');
    for (const i of [6 * 11 + 1, 6 * 11 + 2, 7 * 11 + 2]) arr[i] = TERRAIN_CHAR.water;
    return arr.join('');
  });
  const [confirmed, setConfirmed] = useState(false);
  const game = useMemo(() => tutorialGame(board), [board]);
  const { info, update, rotate, flip, nudge } = useDraft(confirmed ? null : game, 0);
  const [rotated, setRotated] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [sel, setSel] = useState<number | null>(null);

  const step = confirmed
    ? 5
    : info.draft.terrain !== 'farm'
      ? 0
      : !info.valid
        ? 1
        : !(rotated && flipped)
          ? 2
          : sel === null
            ? 3
            : 4;

  const draftBoard = useMemo(() => {
    if (!info.valid) return null;
    const arr = board.split('');
    for (const i of info.cells) arr[i] = TERRAIN_CHAR[info.draft.terrain];
    return arr.join('');
  }, [board, info.valid, info.cells, info.draft.terrain]);

  const highlight = sel !== null ? { cells: objective(game.objectives[sel]).score({ board, ruins: ruinsMask(MAPS.A) }).cells, tone: 'gold' as const } : null;

  const finish = () => {
    profile.setTutorialDone();
    navigate('/');
  };

  return (
    <div className="tutorial-screen">
      <header className="tutorial-head">
        <button type="button" className="btn ghost small" onClick={() => navigate('/')}>
          ← 처음 화면
        </button>
        <h1>1분 체험 튜토리얼</h1>
        <ol className="tut-steps">
          {STEPS.map((s, i) => (
            <li key={i} className={i < step ? 'done' : i === step ? 'now' : ''}>
              {s.title}
            </li>
          ))}
        </ol>
      </header>
      <div className="tutorial-body">
        <div className="tut-board">
          <div className={'do-now ' + (step === 1 && info.draft.anchor !== null && !info.valid ? 'tone-bad' : '')} role="status" aria-live="polite">
            {confirmed ? '🎉 잘했어요! 이것이 한 턴입니다.' : step === 1 && info.draft.anchor !== null && !info.valid ? `${info.error} — 다른 칸을 눌러 보세요.` : STEPS[step].text}
          </div>
          <Board
            board={board}
            mapSide="A"
            preview={!confirmed && info.cells.length ? { cells: info.cells, terrain: info.draft.terrain, valid: info.valid } : null}
            highlight={highlight}
            onCellTap={confirmed ? undefined : (c) => update({ anchor: c })}
          />
          {!confirmed && (
            <div className="action-bar">
              <button
                type="button"
                className="btn icon"
                onClick={() => {
                  rotate();
                  setRotated(true);
                }}
              >
                ⟳<span>회전</span>
              </button>
              <button
                type="button"
                className="btn icon"
                onClick={() => {
                  flip();
                  setFlipped(true);
                }}
              >
                ⇋<span>반전</span>
              </button>
              <div className="nudge">
                <button type="button" className="btn tiny" onClick={() => nudge(0, -1)} aria-label="왼쪽으로">◀</button>
                <div className="nudge-col">
                  <button type="button" className="btn tiny" onClick={() => nudge(-1, 0)} aria-label="위로">▲</button>
                  <button type="button" className="btn tiny" onClick={() => nudge(1, 0)} aria-label="아래로">▼</button>
                </div>
                <button type="button" className="btn tiny" onClick={() => nudge(0, 1)} aria-label="오른쪽으로">▶</button>
              </div>
              <button
                type="button"
                className="btn primary confirm"
                disabled={!info.valid || step < 4}
                onClick={() => {
                  setBoard(draftBoard!);
                  setConfirmed(true);
                  profile.setTutorialDone();
                }}
              >
                배치 확정
              </button>
            </div>
          )}
        </div>
        <aside className="tut-side">
          <CardFace id="orchard-hill" />
          {!confirmed && info.req && (
            <>
              <TerrainButtons terrains={info.req.terrains} value={info.draft.terrain} onChange={(t) => update({ terrain: t })} />
              <div className="shape-now">
                지금 모양: <ShapeGlyph cells={info.req.shapes[0].cells} t={info.draft.t} size={40} color={TERRAIN_META[info.draft.terrain].color} />
              </div>
            </>
          )}
          <h3>목표</h3>
          <ObjectiveList game={game} board={board} draftBoard={draftBoard} hints selected={sel} onSelect={setSel} />
          {confirmed && (
            <div className="tut-done">
              <p>
                계절마다 두 목표로 점수를 얻고, 코인은 계절마다 다시 점수가 됩니다. 몬스터 옆 빈칸은 −1점! 폐허 카드가 나오면 폐허 칸을 덮어야 해요.
              </p>
              <div className="row-buttons">
                <button type="button" className="btn primary big" onClick={finish}>
                  게임하러 가기
                </button>
                <button type="button" className="btn ghost" onClick={() => navigate('/rules')}>
                  규칙 더 보기
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
