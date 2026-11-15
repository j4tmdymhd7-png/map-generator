/**
 * Tiles of the rendered map, so large maps stay sharp at any zoom without one
 * giant bitmap. Each tile covers TILE x TILE squares at one resolution
 * (pixels per square). Least-recently-used tiles are evicted past a pixel budget.
 */
import type { DungeonMap } from '../core/model/types';
import { drawInkRegion, type InkOptions } from './ink';

export const TILE = 16;
const PIXEL_BUDGET = 48_000_000; // ~190 MB of RGBA at most

interface Tile {
  canvas: HTMLCanvasElement;
  cell: number;
  used: number;
}

export class TileCache {
  private tiles = new Map<string, Tile>();
  private pixels = 0;
  private clock = 0;
  private map: DungeonMap;
  private opts: Omit<InkOptions, 'cell'>;

  constructor(map: DungeonMap, opts: Omit<InkOptions, 'cell'>) {
    this.map = map;
    this.opts = opts;
  }

  private key(cell: number, tx: number, ty: number) {
    return `${cell}:${tx}:${ty}`;
  }

  get(cell: number, tx: number, ty: number): HTMLCanvasElement | null {
    const t = this.tiles.get(this.key(cell, tx, ty));
    if (!t) return null;
    t.used = ++this.clock;
    return t.canvas;
  }

  /** Any cached tile for these coordinates, at whatever resolution is closest. */
  fallback(cell: number, tx: number, ty: number): HTMLCanvasElement | null {
    let best: Tile | null = null;
    for (const t of this.tiles.values()) {
      if (!t.canvas.dataset.k?.endsWith(`:${tx}:${ty}`)) continue;
      if (!best || Math.abs(t.cell - cell) < Math.abs(best.cell - cell)) best = t;
    }
    return best?.canvas ?? null;
  }

  build(cell: number, tx: number, ty: number): HTMLCanvasElement {
    const m = this.map;
    const x0 = tx * TILE,
      y0 = ty * TILE;
    const x1 = Math.min(m.width, x0 + TILE),
      y1 = Math.min(m.height, y0 + TILE);
    const canvas = document.createElement('canvas');
    canvas.width = (x1 - x0) * cell;
    canvas.height = (y1 - y0) * cell;
    canvas.dataset.k = this.key(cell, tx, ty);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.translate(-x0 * cell, -y0 * cell);
      drawInkRegion(ctx, m, { ...this.opts, cell }, { x0, y0, x1, y1 });
    }
    this.tiles.set(this.key(cell, tx, ty), { canvas, cell, used: ++this.clock });
    this.pixels += canvas.width * canvas.height;
    this.evict();
    return canvas;
  }

  private evict() {
    if (this.pixels <= PIXEL_BUDGET) return;
    const byAge = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of byAge) {
      if (this.pixels <= PIXEL_BUDGET * 0.8) break;
      this.tiles.delete(k);
      this.pixels -= t.canvas.width * t.canvas.height;
    }
  }
}

/** Pixels per square to render tiles at: a power of two at or above the screen's, capped. */
export function tileCellSize(zoom: number, dpr: number): number {
  return Math.max(8, Math.min(128, 2 ** Math.ceil(Math.log2(Math.max(8, zoom * dpr)))));
}
