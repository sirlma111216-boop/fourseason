// 규칙 배우기: 원작 규칙 요약 + 온라인 편의 규칙 + 커스텀 콘텐츠 구분 + 보관 기간.

import { useEffect } from 'react';
import { AMBUSH_CARDS, EXPLORE_CARDS } from '../../engine/cards';
import { CONTENT_VERSION, SEASON_THRESHOLDS } from '../../engine/game';
import { MAPS, labelOf } from '../../engine/maps';
import { CATEGORY_LABEL, OBJECTIVES } from '../../engine/objectives';
import { BoardSvg } from '../game/Board';
import { ShapeGlyph } from '../game/parts';
import { TERRAIN_META, TerrainIcon } from '../game/terrain';
import { initialBoard } from '../../engine/maps';
import { navigate } from '../router';

export function Rules() {
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);
  return (
    <div className="rules-screen">
      <article className="rules-card">
        <header>
          <button type="button" className="btn ghost small" onClick={() => navigate('/')}>
            ← 처음 화면
          </button>
          <h1>사계절의 지도 — 규칙 배우기</h1>
          <p className="lead">
            모두가 <b>같은 탐험 카드</b>를 보고, <b>동시에</b> 각자의 지도에 지형을 그립니다. 네 계절 동안 목표 카드의 요구를 채워 가장 많은 명성 별(점수)을 얻으면 승리!
          </p>
          <div className="row-buttons">
            <button type="button" className="btn primary" onClick={() => navigate('/tutorial')}>
              ▶ 1분 체험 튜토리얼
            </button>
          </div>
        </header>

        <section>
          <h2>1. 준비</h2>
          <ol>
            <li>모두 같은 빈 지도(11×11 격자, 산·폐허가 인쇄됨)를 받습니다. A면(야생지) 또는 B면(황무지)을 고릅니다.</li>
            <li>목표 카드 네 분류(숲 / 농지·물 / 마을 / 땅의 모양)에서 한 장씩 무작위로 뽑아 A·B·C·D 자리에 놓습니다.</li>
            <li>매복 카드 4장을 섞고, 맨 위 1장을 탐험 카드 13장과 함께 섞어 탐험 덱을 만듭니다.</li>
          </ol>
        </section>

        <section>
          <h2>2. 한 턴의 흐름</h2>
          <ol>
            <li>
              <b>탐험</b>: 탐험 카드 한 장을 공개합니다. <b>폐허</b> 카드가 나오면 바로 한 장을 더 공개합니다(폐허가 또 나오면 또 한 장).
            </li>
            <li>
              <b>그리기</b>: 모두 동시에, 카드에 있는 지형 하나와 모양 하나를 골라 자기 지도에 그립니다. 확정 전에는 마음껏 바꿀 수 있고, 확정하면 바꿀 수 없어요. 다른 사람의 확정 전 배치는 보이지 않습니다.
            </li>
            <li>
              <b>확인</b>: 이번 계절에 공개한 카드들의 시간(⏳) 합이 계절 한도에 닿으면 계절이 끝나고 채점합니다.
            </li>
          </ol>
        </section>

        <section>
          <h2>3. 그리기 규칙</h2>
          <ul>
            <li>모양은 회전·반전할 수 있습니다. 지도 밖으로 나가거나 이미 채워진 칸(산·황무지·다른 지형)과 겹칠 수 없습니다.</li>
            <li>이미 그린 곳 옆에 붙이지 않아도 됩니다. 폐허 칸 위에는 그릴 수 있습니다.</li>
            <li>
              <b>폐허 효과</b>: 폐허 카드 다음에 나온 탐험 카드의 모양은 <b>폐허 칸을 하나 이상 덮어야</b> 합니다. 덮을 수 없거나 빈 폐허가 없으면 아무 빈칸에 1칸을 원하는 지형(산 제외)으로 그립니다.
            </li>
            <li>
              <b>놓을 자리가 없으면</b>: 카드의 어떤 모양도 합법적으로 그릴 수 없으면 아무 빈칸에 1칸을 원하는 지형(산 제외)으로 그립니다.
            </li>
            <li>
              <b>코인</b>: 코인 표시가 있는 모양을 고르면 코인 1개. 산의 상하좌우 네 칸이 모두 채워지면 그 산으로 코인 1개(산마다 한 번). 코인은 <b>계절마다</b> 다시 1점씩 됩니다(최대 14개).
            </li>
          </ul>
          <div className="terrain-legend">
            {(['forest', 'village', 'farm', 'water', 'monster', 'mountain'] as const).map((t) => (
              <span key={t} className="legend-item">
                <TerrainIcon kind={t} size={32} /> {TERRAIN_META[t].label}
              </span>
            ))}
            <span className="legend-item">
              <TerrainIcon kind="ruins" size={32} /> 폐허
            </span>
            <span className="legend-item">
              <TerrainIcon kind="waste" size={32} /> 황무지(채워진 칸)
            </span>
          </div>
        </section>

        <section>
          <h2>4. 매복</h2>
          <ul>
            <li>매복 카드가 나오면 화살표 방향(시계/반시계)으로 이웃의 지도를 받아, 그 지도에 몬스터 모양을 그립니다. 온라인에서는 상대 지도를 잠시 편집하는 화면이 열리고, 서버가 정한 지도에만 그릴 수 있어요.</li>
            <li>그릴 수 없으면 그 지도의 아무 빈칸에 몬스터 1칸.</li>
            <li>계절 끝마다 <b>몬스터와 맞닿은 빈칸 하나당 −1점</b>. 한 빈칸이 여러 몬스터와 닿아도 한 번만 셉니다. 대각선은 맞닿은 것이 아닙니다.</li>
            <li>폐허 다음에 매복이 나오면 매복을 먼저 처리하고, 폐허 효과는 그다음 탐험 카드에 적용됩니다.</li>
            <li>한 계절 동안 공개되지 않은 매복은 덱에 남고, 다음 계절에 매복이 한 장 더 들어갑니다.</li>
          </ul>
        </section>

        <section>
          <h2>5. 계절과 채점</h2>
          <table className="simple">
            <thead>
              <tr>
                <th>계절</th>
                <th>시간 한도 (표준)</th>
                <th>빠른 모드 <span className="badge badge-custom">커스텀</span></th>
                <th>채점 목표</th>
              </tr>
            </thead>
            <tbody>
              {['봄', '여름', '가을', '겨울'].map((s, i) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td>{SEASON_THRESHOLDS.standard[i]}</td>
                  <td>{SEASON_THRESHOLDS.quick[i]}</td>
                  <td>{['A + B', 'B + C', 'C + D', 'D + A'][i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>계절 점수 = 목표 두 장 + 코인 수 − 몬스터 벌점. 겨울이 끝나면 네 계절 합계가 가장 높은 사람이 승리합니다. 동점이면 몬스터로 잃은 점수의 합이 적은 사람이, 그래도 같으면 공동 우승입니다.</p>
          <p>다음 계절에는 공개했던 탐험 카드를 모두 덱에 되돌려 섞고 매복 한 장을 더 섞어 넣습니다.</p>
        </section>

        <section>
          <h2>6. 혼자 하기</h2>
          <ul>
            <li>
              <b>솔로 도전</b>(원작 솔로 규칙): 매복이 나오면 카드가 가리키는 지도 모서리에서 출발해 화살표 방향으로 가장자리를 따라가며, 몬스터 모양을 회전·반전 없이 그릴 수 있는 첫 자리에 자동으로 그립니다. 가장자리에 자리가 없으면 한 칸 안쪽 둘레에서 다시 찾고, 끝내 없으면 그 매복은 무시합니다.
            </li>
            <li>
              원작 솔로 평가 등급은 목표 카드별 보정치가 필요한데, 공식 자료에서 그 값을 확인하지 못해 <b>적용하지 않습니다</b>. 대신 이 기기에 저장한 개인 최고 기록과 비교하고, 앱 자체의 <span className="badge badge-custom">커스텀 칭호</span>를 보여 줍니다.
            </li>
            <li>
              <b>봇 대전</b>: 멀티플레이와 똑같은 규칙·카드로 봇 1~3명과 겨룹니다. 봇은 앞으로 나올 카드나 남의 미확정 배치를 보지 않습니다.
            </li>
          </ul>
        </section>

        <section>
          <h2>7. 온라인 편의 규칙 (원작에 없는 규칙)</h2>
          <ul>
            <li>턴 제한 시간(없음/60초/90초, 기본 90초): 시간이 지나면 서버가 합법적인 배치 중 하나를 대신 고릅니다(일반 배치·매복 모두). 불법 배치나 추가 점수는 주지 않습니다.</li>
            <li>연결이 끊기면 45초 동안 기다린 뒤 임시 봇이 대신 둡니다. 돌아오면 다음 선택부터 다시 직접 합니다. 보드와 점수는 지워지지 않습니다.</li>
            <li>방장은 접속해 있지만 응답이 없는 참가자를 "대리 진행"으로 바꿀 수 있습니다. 본인이 직접 두면 조작을 되찾습니다.</li>
            <li>방장이 30초 넘게 끊기면 접속 중인 다른 사람에게 방장이 넘어갑니다.</li>
            <li>계절 채점 뒤 모두 "준비 완료"를 누르거나 45초가 지나면 다음 계절이 시작됩니다.</li>
            <li>빠른 모드는 계절 시간 한도를 줄인 이 앱의 커스텀 규칙입니다.</li>
            <li>매복 때 지도를 "넘기는" 대신 자리 순서(시계 방향)로 정해진 이웃의 지도를 편집합니다.</li>
          </ul>
        </section>

        <section>
          <h2>8. 카드 데이터와 출처</h2>
          <p>
            <b>원작 확인</b>: 공식 룰북 그림에서 시간·지형·모양(매복은 방향·솔로 모서리)을 직접 확인한 카드. <span className="badge badge-custom">커스텀</span>: 공식 자료에서 앞면을 확인할 수 없어 이 앱이 새로 만든 카드입니다(원작 카드의 재현이 아닙니다). 카드 이름은 모두 이 앱이 붙였습니다.
          </p>
          <table className="simple cards-table">
            <thead>
              <tr>
                <th>카드</th>
                <th>시간</th>
                <th>지형</th>
                <th>모양</th>
                <th>출처</th>
              </tr>
            </thead>
            <tbody>
              {EXPLORE_CARDS.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.time}</td>
                  <td>{c.kind === 'ruins' ? '폐허' : c.terrains.map((t) => TERRAIN_META[t].label).join(' / ')}</td>
                  <td className="shapes-cell">
                    {c.shapes.map((s, i) => (
                      <ShapeGlyph key={i} cells={s.cells} coin={s.coin} size={30} />
                    ))}
                  </td>
                  <td>{c.source === 'official' ? '원작 확인' : <span className="badge badge-custom">커스텀</span>}</td>
                </tr>
              ))}
              {AMBUSH_CARDS.map((a) => (
                <tr key={a.id}>
                  <td>⚔ {a.name}</td>
                  <td>-</td>
                  <td>몬스터 · {a.direction === 'cw' ? '시계' : '반시계'} · 솔로 {{ tl: '왼쪽 위', tr: '오른쪽 위', bl: '왼쪽 아래', br: '오른쪽 아래' }[a.soloCorner]}</td>
                  <td className="shapes-cell">
                    <ShapeGlyph cells={a.cells} size={30} color={TERRAIN_META.monster.color} />
                  </td>
                  <td>{a.source === 'official' ? '원작 확인' : <span className="badge badge-custom">커스텀</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>9. 목표 카드 16장</h2>
          <p>득점 규칙은 공식 룰북 10~11쪽의 규칙 문장과 대조해 구현했습니다. 이름과 설명 문장은 이 앱이 새로 썼습니다.</p>
          <div className="objective-grid">
            {OBJECTIVES.map((o) => (
              <div key={o.id} className={'objective static cat-' + o.category}>
                <div className="obj-head">
                  <strong>{o.name}</strong>
                  <span className="cat">{CATEGORY_LABEL[o.category]}</span>
                </div>
                <p className="obj-rule">{o.rule}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>10. 지도</h2>
          <p>두 지도의 산·폐허·황무지 좌표는 공식 추가 지도지 PDF와 대조했습니다(원작 확인).</p>
          <div className="maps-row">
            {(['A', 'B'] as const).map((side) => (
              <figure key={side}>
                <BoardSvg board={initialBoard(MAPS[side])} mapSide={side} suffix={'-rule' + side} />
                <figcaption>
                  {MAPS[side].name}: 산 {MAPS[side].mountains.map(labelOf).join(' ')} · 폐허 {MAPS[side].ruins.map(labelOf).join(' ')}
                  {MAPS[side].waste.length > 0 && ` · 황무지 ${MAPS[side].waste.map(labelOf).join(' ')}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="privacy">
          <h2>11. 계정·개인정보·보관 기간</h2>
          <ul>
            <li>회원가입·이메일·비밀번호가 없습니다. 닉네임은 표시 이름일 뿐 로그인 수단이 아닙니다.</li>
            <li>방에 들어오면 서버가 무작위 참가자 번호와 복귀용 비밀 토큰을 발급합니다. 토큰은 이 기기(브라우저 저장소)에만 저장되고 다른 참가자·주소창에 노출되지 않습니다. 기기를 바꾸면 같은 자리로 돌아올 수 없습니다.</li>
            <li>
              방 상태는 Cloudflare Durable Object 의 내장 저장소에만 보관합니다(외부 데이터베이스 없음). 게임이 끝난 방은 <b>종료 후 24시간</b>, 활동이 없는 방은 <b>마지막 활동 후 24시간</b>이 지나면 자동으로 지워집니다.
            </li>
            <li>솔로 기록과 혼자 하던 게임은 이 기기에만 저장됩니다. 전체 공개 순위표는 없습니다.</li>
          </ul>
        </section>

        <section>
          <h2>12. 안내</h2>
          <p>
            이 앱은 보드게임 <i>Cartographers</i>(Jordy Adan 디자인, Thunderworks Games) 기본판의 규칙을 참고한 <b>비공식 팬 제작</b> 온라인 구현입니다. 원작의 카드 그림·일러스트·로고를 사용하지 않았고, 공식 제품이 아닙니다. 규칙 데이터 버전: <code>{CONTENT_VERSION}</code>
          </p>
        </section>
      </article>
    </div>
  );
}
