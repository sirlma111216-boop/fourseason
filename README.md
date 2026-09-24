# 사계절의 지도

> 한 장의 지도 위에서 펼쳐지는 네 계절의 작은 세계

친구들과 **같은 탐험 카드**를 보고, **동시에**, 각자 다른 지도를 그리는 온라인 지도 제작 보드게임입니다.
보드게임 *Cartographers* 기본판의 규칙을 참고한 **비공식 팬 제작** 구현이며(작업명: 사계절 지도사), 원작의 카드 그림·로고를 쓰지 않았습니다.
원작에서 확인하지 못한 카드 데이터는 **커스텀 카드**로 새로 만들어 앱과 문서에 표시했습니다 → [docs/rules-reference.md](docs/rules-reference.md)

**배포 주소**: https://four-seasons-map.sirlma.workers.dev

## 할 수 있는 것

- **닉네임만으로 입장**: 회원가입·이메일·비밀번호 없음. 방 만들기 → 6자리 코드·링크 공유 → 친구가 닉네임 입력 후 참가
- **동시 진행**: 모두 같은 카드를 보고 각자 배치, 확정 전 자유 수정, 서버가 합법성·턴·마감을 판정
- **매복**: 이웃의 지도에 몬스터를 그리는 전용 화면(자리 순서 = 시계 방향, 게임 중 고정)
- **계절 채점 연출**: 목표별 점수·코인·벌점을 차례로 보여 주고, 점수 원인 칸을 지도에서 강조, 순위 변화 표시(건너뛰기 가능)
- **게임 종료**: 최종 순위(동점 규칙), 점수 내역, 참가자 지도 갤러리, 내 지도 PNG 저장, 지도 성장 다시 보기, 같은 참가자로 재경기
- **혼자 플레이**: 원작 솔로 규칙의 *솔로 도전*(이 기기의 개인 최고 기록 비교) / 봇 1~3명과 *봇 대전*. 서버 없이 브라우저 안에서 돌아가 오프라인에서도 된다
- **봇**: 초급·중급. 외부 AI API 없음. 미래 카드·남의 미확정 배치는 보지 않는다. 방에는 사람과 봇 합쳐 최대 8자리
- **온라인 편의**: 턴 제한(없음/60/90초, 기본 90초) 시간 초과 자동 배치, 연결 끊김 유예 후 임시 봇, 방장의 대리 진행, 방장 이양, 자동 재연결·재동기화
- **배치 UX**: 칸을 눌러 위치 → 회전·반전 → 확정(드래그 불필요), 반투명 미리보기(초록=가능/빨강=불가+이유), 확대·이동, 한 칸씩 옮기기, 키보드(방향키·R·F·Enter·1~4·Q~T), 모바일 하단 조작부, 색+무늬+아이콘으로 지형 구분
- **첫 실행 튜토리얼**(5단계 직접 조작), **규칙 배우기** 페이지(원작 규칙·온라인 편의 규칙·커스텀 콘텐츠 구분·보관 기간)

## 구조

```
브라우저 (React + Vite, TypeScript)
   │  HTTPS: /api/rooms (방 만들기·상태)      WebSocket: /ws/:code
   ▼
Cloudflare Worker (src/worker/index.ts) ── 정적 화면은 Workers Static Assets(dist/)
   │  idFromName(방 코드)
   ▼
Durable Object: 방 하나 = 객체 하나 (src/worker/room-do.ts)
   - 방·게임 상태를 Durable Object 내장 저장소(SQLite 기반)에 저장
   - WebSocket Hibernation API, alarm 하나로 마감·유예·정리 예약
```

| 폴더 | 내용 |
|---|---|
| `src/engine` | 규칙 엔진(순수 함수): 모양·지도·카드·목표·판정·계절·솔로·봇 |
| `src/room` | 방 규칙(순수): 입장·자리·설정·명령 처리·예약 작업·보기(View) — 서버와 혼자 하기가 같이 씀 |
| `src/shared` | 메시지 형식과 검증 |
| `src/worker` | Worker 진입점과 Durable Object |
| `src/client` | 화면(React) |
| `tests/unit` | 엔진·목표·방 규칙 시험(vitest) |
| `tests/net` | 실제 로컬 Worker 에 붙는 네트워크 시험 |
| `tests/e2e` | 설치된 Chrome 으로 하는 화면 시험(playwright-core) |

### "외부 데이터베이스 설정 없음" ≠ "서버 저장소 없음"

- **필요 없는 것**: Firebase, Supabase, 외부 SQL 서버, 로그인 서비스, Cloudflare D1·KV·R2. 설정할 비밀값도 없습니다.
- **쓰는 것**: Cloudflare **Durable Object 의 내장 저장소**. 방 상태를 여기 저장하므로 새로고침·재접속·서버 재시작(배포) 뒤에도 게임이 이어집니다. Worker 를 배포하면 함께 생기며 따로 만들 필요가 없습니다.
- 정적 호스팅만으로는 여러 기기의 실시간 게임을 동기화할 수 없습니다. 이 프로젝트는 반드시 **Worker + Durable Object** 로 배포해야 멀티플레이가 됩니다(Pages 정적 배포만으로는 안 됨). 한 브라우저의 탭끼리만 통하는 BroadcastChannel 은 쓰지 않습니다.

### 보관 기간

- 끝난 게임의 결과: **종료 후 24시간** 보관 후 자동 삭제
- 활동(사람의 명령·접속)이 없는 방: **마지막 활동 후 24시간** 뒤 자동 삭제. 삭제 전 다시 확인해 진행 중인 게임은 지우지 않음
- 만료된 방 코드는 7일 동안 재사용하지 않고, 링크를 열면 "보관 기간이 지난 방" 안내가 나옵니다
- 복귀용 비밀 토큰은 서버가 발급해 **그 기기의 브라우저 저장소**에만 둡니다(주소·다른 참가자에게 노출 안 함). 기기를 바꾸면 같은 자리로 돌아올 수 없습니다
- 솔로 기록·혼자 하던 게임은 이 기기에만 저장. 전체 공개 순위표 없음

## 로컬에서 실행

필요: Node.js 20 이상(개발은 24에서 확인), npm

```bash
npm install
```

```bash
npm run dev
```

`http://localhost:5173` 을 엽니다(화면은 Vite, 방 서버는 `wrangler dev` 가 8787 에서 함께 뜹니다).
실제 배포와 같은 형태(빌드된 화면 + Worker)로 보려면:

```bash
npm run preview
```

→ `http://127.0.0.1:8787`

## 시험

```bash
npm run verify
```

타입 검사 + 단위 시험 + 빌드. 네트워크 시험(실제 로컬 Worker 에 WebSocket 으로 붙음):

```bash
npm run test:net
```

화면 시험(설치된 Chrome 사용, 다른 브라우저는 `E2E_CHANNEL=msedge`):

```bash
npm run test:e2e
```

배포한 주소에 실제 방을 만들어 두 사람 한 판·봇 8자리 한 판을 돌려 보는 연기 시험(방은 보관 기간 뒤 자동 삭제):

```bash
SMOKE_BASE=https://four-seasons-map.<서브도메인>.workers.dev npm run test:smoke
```

## 배포 (Cloudflare Workers)

### 방법 1. 내 컴퓨터에서 바로

```bash
npx wrangler login
```

```bash
npm run deploy
```

`https://four-seasons-map.<내 서브도메인>.workers.dev` 로 배포됩니다(workers.dev 서브도메인이 없으면 대시보드에서 먼저 정합니다).

### 방법 2. GitHub 저장소를 연결해 자동 배포 (Workers Builds)

1. 이 저장소를 GitHub 에 올립니다.
2. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Import a repository**(또는 이미 배포한 Worker 의 **Settings → Builds → Connect**).
3. GitHub 계정 연결(Cloudflare GitHub 앱 설치 권한 승인) → 저장소 선택.
4. 빌드 설정
   - Worker 이름: **`four-seasons-map`** (`wrangler.jsonc` 의 `name` 과 반드시 같아야 합니다)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
5. 저장하면 이후 `main` 에 push 할 때마다 빌드·배포됩니다.

- 필요한 환경변수·비밀값: **없음**. `TIME_SCALE`, `ROOM_TTL_MS` 는 로컬 시험 전용이며 운영에 넣지 마세요.
- Durable Object 바인딩과 SQLite 마이그레이션(`new_sqlite_classes`)은 `wrangler.jsonc` 에 있어 첫 배포 때 자동으로 적용됩니다.
- 라우팅: `/api/*`, `/ws/*` 는 항상 Worker 가 먼저 받고(JSON·WebSocket), 그 밖의 없는 경로(`/r/ABC123` 새로고침 등)는 SPA `index.html` 을 돌려줍니다.
- 배포하면 진행 중인 WebSocket 이 끊길 수 있습니다. 화면이 자동으로 다시 연결하고 전체 상태를 다시 받습니다. 규칙 데이터 버전이 바뀐 배포라면 진행 중이던 게임은 조용히 이어 가지 않고 대기실로 돌아가며 안내가 표시됩니다.

### 요금과 제한(무료 운영을 보장하지 않습니다)

이 앱이 쓰는 기능: Workers(요청), Workers Static Assets, Durable Objects(SQLite 저장소, WebSocket Hibernation, Alarms).
무료 요금제에도 한도가 있고(예: Durable Object 요청 수·저장소 쓰기 행 수/일), 넘으면 그 종류의 요청이 실패합니다. 최신 값은 아래에서 확인하세요.

- Workers 요금: https://developers.cloudflare.com/workers/platform/pricing/
- Workers 제한: https://developers.cloudflare.com/workers/platform/limits/
- Durable Objects 요금: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Durable Objects 제한: https://developers.cloudflare.com/durable-objects/platform/limits/
- Static Assets: https://developers.cloudflare.com/workers/static-assets/
- WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Workers Builds(GitHub 연결): https://developers.cloudflare.com/workers/ci-cd/builds/

참고로 한 판(사람 몇 명 + 26턴 안팎)은 저장소 쓰기가 명령 수만큼(수백 건) 일어납니다.

## 그림 바꾸기

그림 파일이 없어도 코드로 그린 아이콘·CSS 배경으로 모두 동작합니다. 같은 이름의 파일을 넣으면 바뀝니다(`.webp` 또는 `.png`).

| 파일 | 쓰이는 곳 |
|---|---|
| `public/assets/backgrounds/title.webp` | 첫 화면 일러스트(가운데 양피지 여백에 제목·버튼) |
| `public/assets/backgrounds/title-small.webp` | 모바일 세로 첫 화면(가운데를 잘라 씀) |
| `public/assets/backgrounds/lobby-background.webp` | 대기실·안내 화면 배경 |
| `public/assets/backgrounds/parchment.webp` | 게임·결과·규칙 화면의 양피지 질감(타일) |
| `public/assets/terrain/forest.webp` · `village` · `farm` · `water` · `monster` · `mountain` · `ruins` | 지도 칸의 지형 아이콘(투명 배경 권장, 정사각형) |

격자·모양 미리보기·카드 정보·점수·버튼은 코드로 그리고, 모든 판정은 그림이 아닌 좌표 데이터로 합니다.

## 알려진 제한

- 원작 탐험 카드 8장과 매복 카드 2장의 앞면, 목표 카드의 솔로 보정치는 공식 자료에서 확인하지 못해 커스텀 카드로 대신했습니다(원작 재현이 아님).
- 복귀 정보는 브라우저 저장소에 있어, 기기·브라우저를 바꾸거나 저장소를 지우면 같은 자리로 돌아올 수 없습니다(새 참가자로 들어오게 됨).
- 혼자 하기의 저장 데이터(덱 포함)는 그 기기 브라우저에 있으므로 개발자 도구로 볼 수 있습니다(혼자 하는 게임이라 허용).
- 채팅·음성은 없습니다(짧은 감정 표현만).
