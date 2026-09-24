// 지도 보드(SVG). 좌표로 그리고, 좌표로 판정한다(그림 픽셀과 무관).
// - 칸을 누르면(탭/클릭) onCellTap. 확대 중 손가락으로 끌면 화면 이동, 짧게 누르면 칸 선택.
// - 두 손가락으로 확대·축소, 버튼으로도 확대·축소·맞춤.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MAPS } from '../../engine/maps';
import { N, type DrawTerrain, type MapSide } from '../../engine/types';
import { CHAR_TO_KIND, CellArt, PatternDefs } from './terrain';

export interface PreviewSpec {
  cells: number[];
  terrain: DrawTerrain;
  valid: boolean;
  ghost?: boolean;
}

export interface BoardProps {
  board: string;
  mapSide: MapSide;
  preview?: PreviewSpec | null;
  /** 확정했지만 아직 모두가 끝내지 않아 반영되지 않은 내 배치 */
  pending?: { cells: number[]; terrain: DrawTerrain } | null;
  highlight?: { cells: number[]; tone: 'gold' | 'red' | 'blue' } | null;
  /** 최근에 바뀐 칸(반짝임) */
  fresh?: number[];
  onCellTap?: (cell: number) => void;
  onCellHover?: (cell: number | null) => void;
  cursor?: number | null;
  labels?: boolean;
  zoomable?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
}

const ROWS = 'ABCDEFGHIJK';

export function BoardSvg({
  board,
  mapSide,
  preview,
  pending,
  highlight,
  fresh,
  labels = true,
  cursor,
  svgRef,
  suffix = '',
}: BoardProps & { svgRef?: React.Ref<SVGSVGElement>; suffix?: string }) {
  const ruins = MAPS[mapSide].ruins;
  const m = labels ? 0.65 : 0.06;
  const hl = useMemo(() => new Set(highlight?.cells ?? []), [highlight]);
  const freshSet = useMemo(() => new Set(fresh ?? []), [fresh]);
  const tone = highlight?.tone === 'red' ? '#c0392b' : highlight?.tone === 'blue' ? '#2d7fa0' : '#d9a21b';
  return (
    <svg ref={svgRef} viewBox={`${-m} ${-m} ${N + 2 * m} ${N + 2 * m}`} className="board-svg" role="img" aria-label="지도">
      <PatternDefs id={suffix} />
      <rect x={-m} y={-m} width={N + 2 * m} height={N + 2 * m} fill="#efe2c4" rx="0.3" />
      <rect x={-0.08} y={-0.08} width={N + 0.16} height={N + 0.16} fill="none" stroke="#5a4127" strokeWidth="0.1" rx="0.12" />
      {labels &&
        Array.from({ length: N }, (_, i) => (
          <g key={'l' + i} fontSize="0.34" fill="#6b5640" textAnchor="middle" fontFamily="inherit">
            <text x={i + 0.5} y={-0.2}>
              {i + 1}
            </text>
            <text x={-0.33} y={i + 0.62}>
              {ROWS[i]}
            </text>
          </g>
        ))}
      {/* 빈 격자 */}
      {Array.from({ length: N * N }, (_, i) => {
        const x = i % N;
        const y = Math.floor(i / N);
        return <rect key={'c' + i} x={x + 0.02} y={y + 0.02} width={0.96} height={0.96} rx="0.08" fill={(x + y) % 2 ? '#f7eedb' : '#f3e7cc'} stroke="#d8c39a" strokeWidth="0.025" />;
      })}
      {/* 폐허 표시(칸이 비어 있을 때 또렷하게, 채워지면 모서리에 작게) */}
      {ruins.map((i) => {
        const filled = board[i] !== '.';
        const x = i % N;
        const y = Math.floor(i / N);
        return filled ? (
          <g key={'r' + i}>
            <CellArt kind="ruins" x={x + 0.58} y={y + 0.58} size={0.4} iconOnly patternSuffix={suffix} />
          </g>
        ) : (
          <g key={'r' + i}>
            <rect x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} rx="0.1" fill="#ead7ad" stroke="#b08a4e" strokeWidth="0.04" strokeDasharray="0.12 0.08" />
            <CellArt kind="ruins" x={x} y={y} size={1} iconOnly opacity={0.9} patternSuffix={suffix} />
          </g>
        );
      })}
      {/* 지형 */}
      {board.split('').map((ch, i) => {
        const kind = CHAR_TO_KIND[ch];
        if (!kind) return null;
        const x = i % N;
        const y = Math.floor(i / N);
        return (
          <g key={'t' + i} className={freshSet.has(i) ? 'cell-fresh' : undefined}>
            <CellArt kind={kind} x={x} y={y} patternSuffix={suffix} />
            {ruins.includes(i) && <CellArt kind="ruins" x={x + 0.6} y={y + 0.6} size={0.38} iconOnly patternSuffix={suffix} />}
          </g>
        );
      })}
      {pending &&
        pending.cells.map((i) => (
          <g key={'p' + i}>
            <CellArt kind={pending.terrain} x={i % N} y={Math.floor(i / N)} opacity={0.75} patternSuffix={suffix} />
            <rect x={(i % N) + 0.05} y={Math.floor(i / N) + 0.05} width={0.9} height={0.9} rx="0.1" fill="none" stroke="#3b2a1a" strokeWidth="0.06" strokeDasharray="0.14 0.1" />
          </g>
        ))}
      {highlight && highlight.cells.length > 0 && (
        <g>
          <rect x={0} y={0} width={N} height={N} fill="#2b1d10" opacity="0.28" pointerEvents="none" />
          {[...hl].map((i) => (
            <rect key={'h' + i} x={(i % N) + 0.04} y={Math.floor(i / N) + 0.04} width={0.92} height={0.92} rx="0.12" fill={tone} fillOpacity="0.28" stroke={tone} strokeWidth="0.09" className="cell-glow" />
          ))}
        </g>
      )}
      {preview &&
        preview.cells.map((i) => {
          const x = i % N;
          const y = Math.floor(i / N);
          const color = preview.valid ? '#1f7a3a' : '#c0392b';
          return (
            <g key={'v' + i} className="preview-cell">
              <CellArt kind={preview.terrain} x={x} y={y} opacity={preview.ghost ? 0.35 : 0.62} patternSuffix={suffix} />
              <rect x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} rx="0.12" fill={preview.valid ? 'none' : '#c0392b'} fillOpacity={preview.valid ? 0 : 0.18} stroke={color} strokeWidth={preview.ghost ? 0.05 : 0.1} strokeDasharray={preview.ghost ? '0.1 0.08' : undefined} />
              {!preview.valid && !preview.ghost && (
                <path d={`M${x + 0.3} ${y + 0.3} L${x + 0.7} ${y + 0.7} M${x + 0.7} ${y + 0.3} L${x + 0.3} ${y + 0.7}`} stroke="#c0392b" strokeWidth="0.08" strokeLinecap="round" />
              )}
            </g>
          );
        })}
      {cursor !== null && cursor !== undefined && (
        <rect x={(cursor % N) + 0.02} y={Math.floor(cursor / N) + 0.02} width={0.96} height={0.96} rx="0.1" fill="none" stroke="#2d7fa0" strokeWidth="0.07" pointerEvents="none" />
      )}
    </svg>
  );
}

interface View {
  z: number;
  x: number;
  y: number;
}

/** 보드 + 확대/이동/탭 처리 */
export function Board(props: BoardProps) {
  const { onCellTap, onCellHover, zoomable = true, className, ariaLabel, children } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const [panOnly, setPanOnly] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; view: View; pinchDist: number; pinchMid: { x: number; y: number } } | null>(null);

  const clamp = useCallback((v: View): View => {
    const el = wrapRef.current;
    if (!el) return v;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const z = Math.min(3, Math.max(1, v.z));
    const maxX = 0;
    const minX = w - w * z;
    const maxY = 0;
    const minY = h - h * z;
    return { z, x: Math.min(maxX, Math.max(minX, v.x)), y: Math.min(maxY, Math.max(minY, v.y)) };
  }, []);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      setView((v) => {
        const el = wrapRef.current;
        if (!el) return v;
        const px = cx ?? el.clientWidth / 2;
        const py = cy ?? el.clientHeight / 2;
        const z = Math.min(3, Math.max(1, v.z * factor));
        const k = z / v.z;
        return clamp({ z, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      });
    },
    [clamp],
  );

  const cellAt = useCallback((clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const c = Math.floor(pt.x);
    const r = Math.floor(pt.y);
    if (c < 0 || c >= N || r < 0 || r >= N) return null;
    return r * N + c;
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, zoomable]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const pts = [...pointers.current.values()];
    const rect = wrapRef.current!.getBoundingClientRect();
    if (pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      gesture.current = {
        moved: true,
        startX: 0,
        startY: 0,
        view,
        pinchDist: d,
        pinchMid: { x: (pts[0].x + pts[1].x) / 2 - rect.left, y: (pts[0].y + pts[1].y) / 2 - rect.top },
      };
    } else {
      gesture.current = { moved: false, startX: e.clientX, startY: e.clientY, view, pinchDist: 0, pinchMid: { x: 0, y: 0 } };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && pointers.current.size === 0) {
      onCellHover?.(cellAt(e.clientX, e.clientY));
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.pinchDist > 0 && zoomable) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const z = Math.min(3, Math.max(1, g.view.z * (d / g.pinchDist)));
      const k = z / g.view.z;
      setView(clamp({ z, x: g.pinchMid.x - (g.pinchMid.x - g.view.x) * k, y: g.pinchMid.y - (g.pinchMid.y - g.view.y) * k }));
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 10) g.moved = true;
    if (g.moved && zoomable && g.view.z > 1) setView(clamp({ z: g.view.z, x: g.view.x + dx, y: g.view.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (!g || !wasSingle) return;
    if (g.moved || panOnly) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell !== null) onCellTap?.(cell);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };

  return (
    <div className={'board-frame ' + (className ?? '')} aria-label={ariaLabel}>
      <div
        ref={wrapRef}
        className="board-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => onCellHover?.(null)}
        style={{ touchAction: view.z > 1 ? 'none' : 'pan-y' }}
      >
        <div className="board-zoom" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <BoardSvg {...props} svgRef={svgRef} />
        </div>
      </div>
      {zoomable && (
        <div className="board-tools" role="toolbar" aria-label="지도 확대">
          <button type="button" className="tool" onClick={() => zoomAt(1.35)} aria-label="확대">
            ＋
          </button>
          <button type="button" className="tool" onClick={() => zoomAt(1 / 1.35)} aria-label="축소">
            －
          </button>
          <button type="button" className="tool" onClick={() => setView({ z: 1, x: 0, y: 0 })} aria-label="지도 전체 보기">
            ⤢
          </button>
          {view.z > 1 && (
            <button type="button" className={'tool' + (panOnly ? ' on' : '')} onClick={() => setPanOnly((p) => !p)} aria-pressed={panOnly} title="켜면 지도를 눌러도 배치 위치가 바뀌지 않고 이동만 합니다">
              {panOnly ? '✋' : '👆'}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
