/**
 * Draws fog of war over the map. One pixel per square, scaled up without
 * smoothing, so fog edges land exactly on square edges and never leak a
 * half-square of what's underneath.
 */
import { FOG_EXPLORED, FOG_HIDDEN } from '../core/visibility/fog';
import type { Viewport } from './viewport';

export type FogAudience = 'dm' | 'players';

const SHADE = {
  // DM sees through the fog so they can run the dungeon.
  dm: { hidden: 150, explored: 45 },
  // Players see nothing in unexplored squares and a dimmed memory of explored ones.
  players: { hidden: 255, explored: 120 },
} as const;

let canvas: HTMLCanvasElement | null = null;
let lastFog: Uint8Array | null = null;
let lastAudience: FogAudience | null = null;

function fogBitmap(fog: Uint8Array, width: number, height: number, audience: FogAudience): HTMLCanvasElement {
  if (canvas && lastFog === fog && lastAudience === audience && canvas.width === width && canvas.height === height) return canvas;
  canvas ??= document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const shade = SHADE[audience];
  for (let i = 0; i < fog.length; i++) {
    const a = fog[i] === FOG_HIDDEN ? shade.hidden : fog[i] === FOG_EXPLORED ? shade.explored : 0;
    img.data[i * 4] = 22;
    img.data[i * 4 + 1] = 20;
    img.data[i * 4 + 2] = 26;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  lastFog = fog;
  lastAudience = audience;
  return canvas;
}

export function drawFog(ctx: CanvasRenderingContext2D, v: Viewport, fog: Uint8Array, width: number, height: number, audience: FogAudience): void {
  const bmp = fogBitmap(fog, width, height, audience);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, v.x, v.y, width * v.zoom, height * v.zoom);
  ctx.restore();
}
