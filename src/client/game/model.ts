// 화면 쪽 도우미: 서버가 보낸 보기(View)를 규칙 엔진 함수에 넣을 수 있게 바꾸고, 배치 초안을 관리한다.
// 예상 점수·합법 판정은 서버와 같은 엔진 함수를 쓴다. 최종 판정은 서버가 한다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PLACE_ERROR_TEXT } from '../../engine/board';
import { checkPlacement, requirement, type Requirement } from '../../engine/game';
import { pivotOf, transform } from '../../engine/shapes';
import { N, type DrawTerrain, type Placement } from '../../engine/types';
import { engineState } from '../../room/view-state';
import type { GameView, MemberView, RoomView } from '../../room/types';

export { engineState };

export function displayName(m: Pick<MemberView, 'nick' | 'tag'> | undefined | null): string {
  if (!m) return '?';
  return m.tag ? `${m.nick} #${m.tag}` : m.nick;
}

export function memberAtSeat(room: RoomView, seat: number): MemberView | undefined {
  const id = room.seats[seat];
  return room.members.find((m) => m.id === id);
}

export interface Draft {
  key: string;
  shape: number;
  terrain: DrawTerrain;
  t: number;
  /** 누른 칸(모양의 손잡이 칸이 오는 자리) */
  anchor: number | null;
}

export interface DraftInfo {
  req: Requirement | null;
  draft: Draft;
  cells: number[];
  placement: Placement | null;
  valid: boolean;
  error: string | null;
  fallback: boolean;
}

function computeCells(req: Requirement, d: Draft, fallback: boolean): { cells: number[]; origin: { row: number; col: number } | null } {
  if (d.anchor === null) return { cells: [], origin: null };
  const ar = Math.floor(d.anchor / N);
  const ac = d.anchor % N;
  if (fallback) return { cells: [d.anchor], origin: { row: ar, col: ac } };
  const shape = req.shapes[d.shape];
  if (!shape) return { cells: [], origin: null };
  const v = transform(shape.cells, d.t);
  const [pr, pc] = pivotOf(v);
  const row = ar - pr;
  const col = ac - pc;
  const cells: number[] = [];
  for (const [r, c] of v) {
    const rr = row + r;
    const cc = col + c;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) cells.push(rr * N + cc);
  }
  return { cells, origin: { row, col } };
}

/** 현재 턴의 배치 초안. 턴이 바뀌면 새로 시작한다. */
export function useDraft(game: GameView | null, seat: number) {
  const turnKey = game?.turn ? `${game.no}:${game.turn.id}:${seat}` : 'none';
  const state = useMemo(() => (game ? engineState(game) : null), [game]);
  const req = useMemo(() => (state && seat >= 0 && state.turn ? requirement(state, seat) : null), [state, seat]);
  const initial = useCallback(
    (): Draft => ({
      key: turnKey,
      shape: 0,
      terrain: req ? (req.mustFallback ? (req.kind === 'ambush' ? 'monster' : req.fallbackTerrains[0]) : req.terrains[0]) : 'forest',
      t: 0,
      anchor: null,
    }),
    [turnKey, req],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  useEffect(() => {
    if (draft.key !== turnKey) setDraft(initial());
  }, [turnKey, draft.key, initial]);

  const d = draft.key === turnKey ? draft : initial();
  const fallback = !!req?.mustFallback;

  const info: DraftInfo = useMemo(() => {
    if (!req || !state) return { req, draft: d, cells: [], placement: null, valid: false, error: null, fallback };
    if (req.mustPass) return { req, draft: d, cells: [], placement: { kind: 'pass' }, valid: true, error: null, fallback };
    const { cells, origin } = computeCells(req, d, fallback);
    if (!origin) return { req, draft: d, cells, placement: null, valid: false, error: null, fallback };
    const placement: Placement = fallback
      ? { kind: 'single', terrain: d.terrain, row: origin.row, col: origin.col }
      : { kind: 'shape', shape: d.shape, terrain: d.terrain, t: d.t, row: origin.row, col: origin.col };
    // 지도 밖 기준점도 서버와 같은 판정을 받게 그대로 넘긴다
    const res =
      placement.kind === 'shape' && (origin.row < 0 || origin.col < 0)
        ? ({ ok: false, error: 'out-of-bounds' } as const)
        : checkPlacement(state, seat, placement);
    return {
      req,
      draft: d,
      cells,
      placement,
      valid: res.ok,
      error: res.ok ? null : PLACE_ERROR_TEXT[res.error],
      fallback,
    };
  }, [req, state, d, seat, fallback]);

  const update = useCallback(
    (p: Partial<Draft>) => setDraft((cur) => ({ ...(cur.key === turnKey ? cur : initial()), ...p, key: turnKey })),
    [turnKey, initial],
  );

  const rotate = useCallback(() => {
    setDraft((cur) => {
      const base = cur.key === turnKey ? cur : initial();
      const flip = base.t >= 4 ? 4 : 0;
      return { ...base, t: flip + (((base.t % 4) + 1) % 4) };
    });
  }, [turnKey, initial]);

  /** 화면에 보이는 모양을 좌우로 뒤집는다(회전 상태와 무관하게 눈에 보이는 대로) */
  const flip = useCallback(() => {
    setDraft((cur) => {
      const base = cur.key === turnKey ? cur : initial();
      const rot = base.t % 4;
      const isFlipped = base.t >= 4;
      return { ...base, t: (isFlipped ? 0 : 4) + ((4 - rot) % 4) };
    });
  }, [turnKey, initial]);

  const nudge = useCallback(
    (dr: number, dc: number) => {
      setDraft((cur) => {
        const base = cur.key === turnKey ? cur : initial();
        const a = base.anchor ?? Math.floor(N / 2) * N + Math.floor(N / 2);
        const r = Math.min(N - 1, Math.max(0, Math.floor(a / N) + (base.anchor === null ? 0 : dr)));
        const c = Math.min(N - 1, Math.max(0, (a % N) + (base.anchor === null ? 0 : dc)));
        return { ...base, anchor: r * N + c };
      });
    },
    [turnKey, initial],
  );

  return { info, update, rotate, flip, nudge };
}

/** 칸 이름(예: C7) */
export function cellLabel(i: number): string {
  return 'ABCDEFGHIJK'[Math.floor(i / N)] + String((i % N) + 1);
}
