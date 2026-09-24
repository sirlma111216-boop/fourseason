// 지형 표시: 색 + 무늬 + 아이콘(그림 파일이 없으면 코드로 그린 SVG). 색만으로 구분하지 않게 한다.

import type { ReactNode } from 'react';
import { assetUrl, useAssets, type AssetKey } from '../assets';
import type { Terrain } from '../../engine/types';

export type CellKind = Terrain | 'waste' | 'ruins';

export const TERRAIN_META: Record<Terrain, { label: string; color: string; edge: string; pattern: string }> = {
  forest: { label: '숲', color: '#7fae5e', edge: '#3f6b33', pattern: 'pat-forest' },
  village: { label: '마을', color: '#e0876a', edge: '#9c4a31', pattern: 'pat-village' },
  farm: { label: '농지', color: '#f0c865', edge: '#a8801f', pattern: 'pat-farm' },
  water: { label: '물', color: '#79c3de', edge: '#2d7fa0', pattern: 'pat-water' },
  monster: { label: '몬스터', color: '#b18ac6', edge: '#6a3c80', pattern: 'pat-monster' },
  mountain: { label: '산', color: '#b3a595', edge: '#6e6153', pattern: 'pat-mountain' },
};

export const CHAR_TO_KIND: Record<string, CellKind | undefined> = {
  F: 'forest',
  V: 'village',
  A: 'farm',
  W: 'water',
  M: 'monster',
  X: 'mountain',
  '#': 'waste',
};

/** SVG 무늬 정의(보드 SVG 안에 한 번 넣는다) */
export function PatternDefs({ id = '' }: { id?: string }) {
  return (
    <defs>
      <pattern id={`pat-forest${id}`} width="0.25" height="0.25" patternUnits="userSpaceOnUse">
        <circle cx="0.125" cy="0.125" r="0.03" fill="#2f5a25" opacity="0.35" />
      </pattern>
      <pattern id={`pat-village${id}`} width="0.2" height="0.2" patternUnits="userSpaceOnUse">
        <rect x="0.07" y="0.07" width="0.06" height="0.06" fill="#7a2f1b" opacity="0.28" />
      </pattern>
      <pattern id={`pat-farm${id}`} width="0.18" height="0.18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="0.05" height="0.18" fill="#8a6414" opacity="0.28" />
      </pattern>
      <pattern id={`pat-water${id}`} width="0.34" height="0.2" patternUnits="userSpaceOnUse">
        <path d="M0 0.12 Q0.085 0.05 0.17 0.12 T0.34 0.12" fill="none" stroke="#1d5f7a" strokeWidth="0.022" opacity="0.4" />
      </pattern>
      <pattern id={`pat-monster${id}`} width="0.2" height="0.2" patternUnits="userSpaceOnUse">
        <path d="M0 0.2 L0.2 0 M-0.05 0.05 L0.05 -0.05 M0.15 0.25 L0.25 0.15" stroke="#4a1f5c" strokeWidth="0.025" opacity="0.35" />
        <path d="M0 0 L0.2 0.2" stroke="#4a1f5c" strokeWidth="0.025" opacity="0.35" />
      </pattern>
      <pattern id={`pat-mountain${id}`} width="0.25" height="0.25" patternUnits="userSpaceOnUse">
        <path d="M0.03 0.2 L0.125 0.06 L0.22 0.2" fill="none" stroke="#4a3f33" strokeWidth="0.02" opacity="0.3" />
      </pattern>
      <pattern id={`pat-waste${id}`} width="0.14" height="0.14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="0.035" height="0.14" fill="#3b3128" opacity="0.55" />
      </pattern>
    </defs>
  );
}

/** 그림 파일이 없을 때 쓰는 간결한 SVG 아이콘(한 칸 = 1 단위) */
function FallbackIcon({ kind }: { kind: CellKind }): ReactNode {
  const s = { fill: 'none', stroke: '#3b2a1a', strokeWidth: 0.06, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'forest':
      return (
        <g {...s}>
          <path d="M0.5 0.15 L0.75 0.62 L0.25 0.62 Z" fill="#3f6b33" />
          <path d="M0.5 0.62 L0.5 0.82" />
        </g>
      );
    case 'village':
      return (
        <g {...s}>
          <path d="M0.22 0.48 L0.5 0.2 L0.78 0.48 L0.78 0.8 L0.22 0.8 Z" fill="#c75c3c" />
          <path d="M0.44 0.8 L0.44 0.6 L0.56 0.6 L0.56 0.8" />
        </g>
      );
    case 'farm':
      return (
        <g {...s}>
          <path d="M0.25 0.8 Q0.3 0.4 0.55 0.2 M0.42 0.82 Q0.47 0.45 0.72 0.25 M0.6 0.82 Q0.64 0.55 0.8 0.42" stroke="#8a6414" />
        </g>
      );
    case 'water':
      return (
        <g {...s} stroke="#1d5f7a">
          <path d="M0.18 0.35 Q0.34 0.22 0.5 0.35 T0.82 0.35" />
          <path d="M0.18 0.55 Q0.34 0.42 0.5 0.55 T0.82 0.55" />
          <path d="M0.18 0.75 Q0.34 0.62 0.5 0.75 T0.82 0.75" />
        </g>
      );
    case 'monster':
      return (
        <g {...s}>
          <path d="M0.25 0.35 L0.2 0.15 L0.38 0.28 M0.75 0.35 L0.8 0.15 L0.62 0.28" />
          <ellipse cx="0.5" cy="0.55" rx="0.28" ry="0.25" fill="#8e5aa8" />
          <circle cx="0.4" cy="0.5" r="0.04" fill="#f5d36a" stroke="none" />
          <circle cx="0.6" cy="0.5" r="0.04" fill="#f5d36a" stroke="none" />
          <path d="M0.4 0.65 Q0.5 0.72 0.6 0.65" />
        </g>
      );
    case 'mountain':
      return (
        <g {...s}>
          <path d="M0.12 0.8 L0.4 0.25 L0.58 0.55 L0.68 0.4 L0.88 0.8 Z" fill="#8a7a6a" />
          <path d="M0.32 0.4 L0.4 0.25 L0.48 0.4" stroke="#fff" />
        </g>
      );
    case 'ruins':
      return (
        <g {...s} stroke="#8a6a3a">
          <path d="M0.3 0.8 L0.3 0.35 L0.46 0.35 L0.46 0.8 M0.25 0.35 L0.51 0.35 M0.58 0.8 L0.58 0.55 L0.72 0.5 L0.72 0.8" />
        </g>
      );
    case 'waste':
      return null;
  }
}

/** 한 칸 그리기. (x, y) 는 칸 왼쪽 위, size 는 칸 크기(보통 1). */
export function CellArt({
  kind,
  x,
  y,
  size = 1,
  opacity = 1,
  patternSuffix = '',
  iconOnly = false,
}: {
  kind: CellKind;
  x: number;
  y: number;
  size?: number;
  opacity?: number;
  patternSuffix?: string;
  iconOnly?: boolean;
}) {
  useAssets();
  const pad = 0.04 * size;
  const url = kind === 'waste' ? null : assetUrl(kind as AssetKey);
  if (kind === 'waste') {
    return (
      <g opacity={opacity}>
        <rect x={x + pad} y={y + pad} width={size - 2 * pad} height={size - 2 * pad} rx={0.08 * size} fill="#7d7266" />
        <rect x={x + pad} y={y + pad} width={size - 2 * pad} height={size - 2 * pad} rx={0.08 * size} fill={`url(#pat-waste${patternSuffix})`} />
      </g>
    );
  }
  const meta = kind === 'ruins' ? null : TERRAIN_META[kind];
  return (
    <g opacity={opacity}>
      {meta && !iconOnly && (
        <>
          <rect x={x + pad} y={y + pad} width={size - 2 * pad} height={size - 2 * pad} rx={0.1 * size} fill={meta.color} stroke={meta.edge} strokeWidth={0.035 * size} />
          <rect x={x + pad} y={y + pad} width={size - 2 * pad} height={size - 2 * pad} rx={0.1 * size} fill={`url(#${meta.pattern}${patternSuffix})`} />
        </>
      )}
      {url ? (
        <image href={url} x={x + size * 0.1} y={y + size * 0.1} width={size * 0.8} height={size * 0.8} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <g transform={`translate(${x} ${y}) scale(${size})`}>
          <FallbackIcon kind={kind} />
        </g>
      )}
    </g>
  );
}

/** 버튼 등 HTML 안에서 쓰는 작은 지형 아이콘 */
export function TerrainIcon({ kind, size = 28, title }: { kind: CellKind; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1 1" role="img" aria-label={title ?? (kind in TERRAIN_META ? TERRAIN_META[kind as Terrain].label : kind)}>
      <PatternDefs id="-icon" />
      <CellArt kind={kind} x={0} y={0} size={1} patternSuffix="-icon" />
    </svg>
  );
}
