// 내 지도를 PNG 로 저장. 닉네임과 게임 결과만 넣고 방 코드·비밀 정보는 넣지 않는다.

import { SEASON_NAMES } from '../../engine/game';
import { MAPS } from '../../engine/maps';
import { N, type MapSide, type SeasonScore } from '../../engine/types';
import { assetUrl, type AssetKey } from '../assets';
import { CHAR_TO_KIND, TERRAIN_META } from './terrain';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function exportMapPng(opts: {
  board: string;
  mapSide: MapSide;
  name: string;
  total: number;
  rank: number | null;
  seasons: SeasonScore[];
}): Promise<void> {
  const cell = 64;
  const pad = 48;
  const head = 120;
  const foot = 110;
  const W = N * cell + pad * 2;
  const H = head + N * cell + foot + pad;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3e7cc';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3b2a1a';
  ctx.font = 'bold 40px "Gowun Batang", "Nanum Myeongjo", Batang, serif';
  ctx.textAlign = 'center';
  ctx.fillText('사계절의 지도', W / 2, 58);
  ctx.font = '26px "Gowun Batang", "Nanum Myeongjo", Batang, serif';
  ctx.fillText(`${opts.name} 지도사 · ${opts.total}점${opts.rank ? ` · ${opts.rank}위` : ''}`, W / 2, 98);

  const keys: AssetKey[] = ['forest', 'village', 'farm', 'water', 'monster', 'mountain', 'ruins'];
  const imgs: Partial<Record<AssetKey, HTMLImageElement | null>> = {};
  await Promise.all(
    keys.map(async (k) => {
      const url = assetUrl(k);
      imgs[k] = url ? await loadImage(url) : null;
    }),
  );
  const ruins = new Set(MAPS[opts.mapSide].ruins);
  for (let i = 0; i < N * N; i++) {
    const x = pad + (i % N) * cell;
    const y = head + Math.floor(i / N) * cell;
    ctx.fillStyle = ((i % N) + Math.floor(i / N)) % 2 ? '#f7eedb' : '#efe0bf';
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = '#d8c39a';
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    const kind = CHAR_TO_KIND[opts.board[i]];
    if (kind === 'waste') {
      ctx.fillStyle = '#7d7266';
      ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
    } else if (kind && kind !== 'ruins') {
      const meta = TERRAIN_META[kind];
      ctx.fillStyle = meta.color;
      ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
      const img = imgs[kind as AssetKey];
      if (img) ctx.drawImage(img, x + 7, y + 7, cell - 14, cell - 14);
      else {
        ctx.fillStyle = meta.edge;
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(meta.label[0], x + cell / 2, y + cell / 2 + 9);
      }
    }
    if (ruins.has(i)) {
      const img = imgs.ruins;
      const s = kind ? 24 : cell - 10;
      if (img) ctx.drawImage(img, x + cell - s - 3, y + cell - s - 3, s, s);
    }
  }
  ctx.strokeStyle = '#5a4127';
  ctx.lineWidth = 4;
  ctx.strokeRect(pad - 2, head - 2, N * cell + 4, N * cell + 4);

  ctx.fillStyle = '#3b2a1a';
  ctx.textAlign = 'center';
  ctx.font = '22px "Gowun Batang", "Nanum Myeongjo", Batang, serif';
  const line = opts.seasons.map((s) => `${SEASON_NAMES[s.season]} ${s.total}`).join('  ·  ');
  ctx.fillText(line, W / 2, head + N * cell + 48);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#6b5640';
  ctx.fillText('비공식 팬 제작 온라인 게임 「사계절의 지도」', W / 2, head + N * cell + 84);

  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `사계절의지도_${opts.name.replace(/[\\/:*?"<>|]/g, '')}.png`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
