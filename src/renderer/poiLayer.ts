/**
 * Points of interest: an ink badge with a symbol for each kind of place,
 * its name when zoomed in, and a door mark at the entrance.
 *
 * Every kind has its own shape, so nothing depends on color. DM-only places
 * (hidden, or a thieves' den) get a dashed badge and are left out of
 * Player view entirely.
 */
import type { PoiObject, PoiType } from '../core/model/types';
import { INK } from './ink';
import type { Viewport } from './viewport';

type Glyph = (ctx: CanvasRenderingContext2D) => void;

const line = (ctx: CanvasRenderingContext2D, pts: number[][]) => {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
};
const house: Glyph = (ctx) => {
  line(ctx, [
    [-0.7, 0.75],
    [-0.7, -0.05],
    [0, -0.7],
    [0.7, -0.05],
    [0.7, 0.75],
  ]);
  ctx.closePath();
  ctx.stroke();
  ctx.fillRect(-0.15, 0.25, 0.3, 0.5);
};

/** Symbols drawn in a unit box (-1..1), stroked and filled with the current ink. */
const GLYPHS: Record<PoiType, Glyph> = {
  tavern: (ctx) => {
    // Tankard with a handle and foam
    ctx.strokeRect(-0.55, -0.45, 0.8, 1.15);
    ctx.beginPath();
    ctx.arc(0.25, 0.1, 0.32, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-0.35, -0.5, 0.2, Math.PI, 0);
    ctx.arc(0.05, -0.5, 0.2, Math.PI, 0);
    ctx.fill();
  },
  inn: (ctx) => {
    // Bed: frame, pillow, blanket
    ctx.strokeRect(-0.8, -0.1, 1.6, 0.5);
    line(ctx, [
      [-0.8, -0.5],
      [-0.8, 0.7],
    ]);
    ctx.stroke();
    line(ctx, [
      [0.8, 0.4],
      [0.8, 0.7],
    ]);
    ctx.stroke();
    ctx.fillRect(-0.65, -0.35, 0.4, 0.25);
    ctx.fillRect(-0.15, -0.3, 0.95, 0.2);
  },
  temple: (ctx) => {
    // Sun with rays
    ctx.beginPath();
    ctx.arc(0, 0, 0.32, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      line(ctx, [
        [Math.cos(a) * 0.48, Math.sin(a) * 0.48],
        [Math.cos(a) * 0.8, Math.sin(a) * 0.8],
      ]);
      ctx.stroke();
    }
  },
  smithy: (ctx) => {
    // Anvil
    line(ctx, [
      [-0.85, -0.35],
      [0.6, -0.35],
      [0.85, -0.15],
      [0.3, 0.05],
      [0.2, 0.35],
      [0.45, 0.6],
      [-0.45, 0.6],
      [-0.2, 0.35],
      [-0.3, 0.05],
      [-0.6, -0.05],
    ]);
    ctx.closePath();
    ctx.fill();
  },
  market: (ctx) => {
    // Striped awning over a counter
    line(ctx, [
      [-0.8, -0.2],
      [-0.6, -0.6],
      [0.6, -0.6],
      [0.8, -0.2],
    ]);
    ctx.closePath();
    ctx.stroke();
    for (const x of [-0.4, 0, 0.4]) {
      line(ctx, [
        [x - 0.12, -0.6],
        [x + 0.08, -0.2],
      ]);
      ctx.stroke();
    }
    ctx.strokeRect(-0.6, 0.15, 1.2, 0.5);
    line(ctx, [
      [-0.6, -0.2],
      [-0.6, 0.15],
    ]);
    ctx.stroke();
    line(ctx, [
      [0.6, -0.2],
      [0.6, 0.15],
    ]);
    ctx.stroke();
  },
  barracks: (ctx) => {
    // Shield with a bar
    line(ctx, [
      [-0.65, -0.7],
      [0.65, -0.7],
      [0.6, 0.1],
      [0, 0.8],
      [-0.6, 0.1],
    ]);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(-0.62, -0.2, 1.24, 0.25);
  },
  gatehouse: (ctx) => {
    // Gate: arch with portcullis bars
    ctx.beginPath();
    ctx.moveTo(-0.7, 0.75);
    ctx.lineTo(-0.7, -0.1);
    ctx.arc(0, -0.1, 0.7, Math.PI, 0);
    ctx.lineTo(0.7, 0.75);
    ctx.stroke();
    for (const x of [-0.35, 0, 0.35]) {
      line(ctx, [
        [x, -0.6],
        [x, 0.75],
      ]);
      ctx.stroke();
    }
    line(ctx, [
      [-0.7, 0.2],
      [0.7, 0.2],
    ]);
    ctx.stroke();
  },
  estate: (ctx) => {
    // Crown
    line(ctx, [
      [-0.75, 0.5],
      [-0.75, -0.45],
      [-0.35, 0],
      [0, -0.65],
      [0.35, 0],
      [0.75, -0.45],
      [0.75, 0.5],
    ]);
    ctx.closePath();
    ctx.fill();
  },
  'thieves-den': (ctx) => {
    // Mask with eye holes
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.85, 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK.floor;
    ctx.beginPath();
    ctx.ellipse(-0.35, -0.02, 0.2, 0.13, 0, 0, Math.PI * 2);
    ctx.ellipse(0.35, -0.02, 0.2, 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK.ink;
  },
  docks: (ctx) => {
    // Anchor
    line(ctx, [
      [0, -0.55],
      [0, 0.7],
    ]);
    ctx.stroke();
    line(ctx, [
      [-0.35, -0.3],
      [0.35, -0.3],
    ]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -0.68, 0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0.15, 0.6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  },
  apothecary: (ctx) => {
    // Flask
    line(ctx, [
      [-0.15, -0.75],
      [0.15, -0.75],
      [0.15, -0.2],
      [0.6, 0.65],
      [-0.6, 0.65],
      [-0.15, -0.2],
    ]);
    ctx.closePath();
    ctx.stroke();
    line(ctx, [
      [-0.38, 0.2],
      [0.38, 0.2],
      [0.6, 0.65],
      [-0.6, 0.65],
    ]);
    ctx.closePath();
    ctx.fill();
  },
  stables: (ctx) => {
    // Horseshoe
    ctx.save();
    ctx.lineWidth *= 2.2;
    ctx.beginPath();
    ctx.arc(0, -0.05, 0.5, Math.PI * 0.85, Math.PI * 2.15);
    ctx.stroke();
    ctx.restore();
  },
  'general-store': (ctx) => {
    // Crate
    ctx.strokeRect(-0.65, -0.55, 1.3, 1.1);
    line(ctx, [
      [-0.65, -0.55],
      [0.65, 0.55],
    ]);
    ctx.stroke();
    line(ctx, [
      [0.65, -0.55],
      [-0.65, 0.55],
    ]);
    ctx.stroke();
  },
  'bandit-camp': (ctx) => {
    // Tent with crossed poles
    line(ctx, [
      [-0.8, 0.65],
      [0, -0.55],
      [0.8, 0.65],
    ]);
    ctx.closePath();
    ctx.fill();
    line(ctx, [
      [-0.2, -0.8],
      [0.15, -0.35],
    ]);
    ctx.stroke();
    line(ctx, [
      [0.2, -0.8],
      [-0.15, -0.35],
    ]);
    ctx.stroke();
  },
  'hermit-hut': house,
  'abandoned-farm': (ctx) => {
    house(ctx);
    // A gap in the roof
    ctx.fillStyle = INK.floor;
    ctx.fillRect(0.12, -0.5, 0.3, 0.3);
    ctx.fillStyle = INK.ink;
  },
  'ranger-lodge': (ctx) => {
    house(ctx);
    // Antlers over the door
    line(ctx, [
      [-0.35, -0.95],
      [0, -0.75],
      [0.35, -0.95],
    ]);
    ctx.stroke();
  },
  shrine: (ctx) => {
    // Small roofed stone on a step
    line(ctx, [
      [-0.55, -0.2],
      [0, -0.75],
      [0.55, -0.2],
    ]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeRect(-0.35, -0.2, 0.7, 0.65);
    ctx.fillRect(-0.7, 0.45, 1.4, 0.25);
  },
  'cave-mouth': (ctx) => {
    // Dark arch in a rock
    line(ctx, [
      [-0.85, 0.65],
      [-0.5, -0.45],
      [0, -0.7],
      [0.55, -0.4],
      [0.85, 0.65],
    ]);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.4, 0.65);
    ctx.arc(0, 0.25, 0.4, Math.PI, 0);
    ctx.lineTo(0.4, 0.65);
    ctx.closePath();
    ctx.fill();
  },
  ruins: (ctx) => {
    // Broken columns
    ctx.fillRect(-0.7, -0.4, 0.35, 1.05);
    ctx.fillRect(-0.15, 0.05, 0.35, 0.6);
    ctx.fillRect(0.4, -0.65, 0.35, 1.3);
    ctx.fillRect(-0.85, 0.65, 1.7, 0.12);
  },
  'standing-stones': (ctx) => {
    for (const [x, h] of [
      [-0.55, 0.9],
      [0, 1.3],
      [0.55, 1.0],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x, 0.65 - h / 2, 0.18, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  campsite: (ctx) => {
    // Flame over crossed logs
    ctx.beginPath();
    ctx.moveTo(0, -0.75);
    ctx.quadraticCurveTo(0.55, -0.1, 0, 0.35);
    ctx.quadraticCurveTo(-0.55, -0.1, 0, -0.75);
    ctx.fill();
    line(ctx, [
      [-0.65, 0.4],
      [0.65, 0.75],
    ]);
    ctx.stroke();
    line(ctx, [
      [0.65, 0.4],
      [-0.65, 0.75],
    ]);
    ctx.stroke();
  },
};

/** Draw one badge with its symbol, centered at (cx, cy), radius r (screen px). */
export function drawPoiBadge(ctx: CanvasRenderingContext2D, type: PoiType, cx: number, cy: number, r: number, dmOnly: boolean, selected: boolean) {
  ctx.save();
  ctx.fillStyle = INK.floor;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(1.2, r * 0.12);
  if (dmOnly) ctx.setLineDash([r * 0.3, r * 0.22]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  if (selected) {
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.translate(cx, cy);
  const k = r * 0.62;
  ctx.scale(k, k);
  ctx.fillStyle = INK.ink;
  ctx.lineWidth = Math.max(1.1, r * 0.11) / k;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  GLYPHS[type](ctx);
  ctx.restore();
}

export function poiAnchor(p: PoiObject): { x: number; y: number } {
  return p.rect ? { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 } : { x: p.at.x + 0.5, y: p.at.y + 0.5 };
}

export interface PoiDrawOptions {
  playerView: boolean;
  selectedId: string | null;
  /** Players only see places in squares they have explored. */
  seen?: (p: PoiObject) => boolean;
}

export function drawPois(ctx: CanvasRenderingContext2D, v: Viewport, pois: PoiObject[], o: PoiDrawOptions) {
  const z = v.zoom;
  const r = Math.max(7, Math.min(20, z * 0.9));
  const labels = z >= 9;
  ctx.save();
  for (const p of pois) {
    const dmOnly = p.visibility === 'dm';
    if (o.playerView && (dmOnly || (o.seen && !o.seen(p)))) continue;
    const a = poiAnchor(p);
    const cx = v.x + a.x * z,
      cy = v.y + a.y * z;
    // Door mark at the entrance (when there's a building to go into)
    if (p.rect && z >= 6) {
      const ex = v.x + (p.at.x + 0.5) * z,
        ey = v.y + (p.at.y + 0.5) * z;
      ctx.fillStyle = INK.ink;
      ctx.beginPath();
      ctx.moveTo(ex, ey - z * 0.22);
      ctx.lineTo(ex + z * 0.22, ey);
      ctx.lineTo(ex, ey + z * 0.22);
      ctx.lineTo(ex - z * 0.22, ey);
      ctx.closePath();
      ctx.fill();
    }
    drawPoiBadge(ctx, p.poiType, cx, cy, r, dmOnly, p.id === o.selectedId);
    if (labels) {
      const fs = Math.max(11, Math.min(15, z * 0.5));
      ctx.font = `italic ${fs}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = INK.floor;
      ctx.fillStyle = INK.ink;
      ctx.strokeText(p.name, cx, cy + r + 3);
      ctx.fillText(p.name, cx, cy + r + 3);
    }
  }
  ctx.restore();
}

/** The place at a square: its building or area, or its entrance square. Smallest area wins. */
export function poiAt(pois: PoiObject[], cell: { x: number; y: number }): PoiObject | null {
  let best: PoiObject | null = null;
  let bestArea = Infinity;
  for (const p of pois) {
    const inRect = p.rect && cell.x >= p.rect.x && cell.y >= p.rect.y && cell.x < p.rect.x + p.rect.w && cell.y < p.rect.y + p.rect.h;
    const atDoor = p.at.x === cell.x && p.at.y === cell.y;
    if (!inRect && !atDoor) continue;
    const area = atDoor ? 0 : p.rect!.w * p.rect!.h;
    if (area < bestArea) {
      best = p;
      bestArea = area;
    }
  }
  return best;
}
