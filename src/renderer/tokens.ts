/**
 * Dynamic layer: avatar tokens and the movement preview, drawn in screen
 * space on top of the cached ink map every frame.
 *
 * Token sides are told apart by ring style, not color:
 *   party = solid ring, enemy = spiked ring, neutral = dashed ring.
 */
import type { Point, Token } from '../core/model/types';
import { footprintSquares } from '../core/rules/dnd2024';
import type { PathResult } from '../core/rules/pathfinding';
import { getPortrait, initials } from './avatars';
import { INK } from './ink';
import type { Viewport } from './viewport';

export interface TokenDrawState {
  selectedId: string | null;
  /** Fractional grid position override for a token mid-animation. */
  animating?: { id: string; pos: Point } | null;
  onImageLoad: () => void;
}

function ring(ctx: CanvasRenderingContext2D, t: Token, cx: number, cy: number, r: number) {
  const w = Math.max(2, r * 0.16);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = w;
  if (t.side === 'neutral') ctx.setLineDash([w * 1.4, w * 1.1]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (t.side === 'enemy') {
    ctx.fillStyle = INK.ink;
    const spikes = 10;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const a1 = a - 0.13,
        a2 = a + 0.13;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      ctx.lineTo(cx + Math.cos(a) * r * 1.22, cy + Math.sin(a) * r * 1.22);
      ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Thin paper ring inside the ink so portraits don't bleed into the frame.
  ctx.strokeStyle = INK.floor;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, r - w * 0.55, 0, Math.PI * 2);
  ctx.stroke();
}

function drawOne(ctx: CanvasRenderingContext2D, v: Viewport, t: Token, pos: Point, selected: boolean, onImageLoad: () => void) {
  const s = footprintSquares(t.size);
  const sizePx = s * v.zoom * (t.size === 'tiny' ? 0.5 : 1);
  const cx = v.x + (pos.x + s / 2) * v.zoom,
    cy = v.y + (pos.y + s / 2) * v.zoom;
  const r = (sizePx / 2) * 0.84;

  // Drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * 0.35;
  ctx.shadowOffsetY = r * 0.08;
  ctx.fillStyle = INK.floor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Portrait or initials
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const img = t.image ? getPortrait(t.image, onImageLoad) : null;
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = t.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK.ink;
    ctx.font = `bold ${Math.round(r * 0.8)}px Georgia, 'Palatino Linotype', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(t.label), cx, cy + r * 0.05);
  }
  ctx.restore();

  ring(ctx, t, cx, cy, r);

  if (selected) {
    ctx.strokeStyle = INK.ink;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.setLineDash([r * 0.25, r * 0.15]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (t.side === 'enemy' ? 1.38 : 1.25), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Name banner once there's room to read it.
  if (v.zoom >= 26) {
    const fs = Math.max(10, Math.min(15, v.zoom * 0.3));
    ctx.font = `600 ${fs}px Georgia, 'Palatino Linotype', serif`;
    const label = t.label;
    const tw = ctx.measureText(label).width;
    const bx = cx - tw / 2 - 5,
      by = cy + r * (t.side === 'enemy' ? 1.25 : 1.05),
      bw = tw + 10,
      bh = fs + 6;
    ctx.fillStyle = INK.floor;
    ctx.strokeStyle = INK.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, by + bh / 2 + 0.5);
  }
}

export function drawTokens(ctx: CanvasRenderingContext2D, v: Viewport, tokens: Token[], st: TokenDrawState): void {
  // Selected token last so it sits on top.
  const ordered = [...tokens].sort((a, b) => Number(a.id === st.selectedId) - Number(b.id === st.selectedId));
  for (const t of ordered) {
    const pos = st.animating?.id === t.id ? st.animating.pos : t.position;
    drawOne(ctx, v, t, pos, t.id === st.selectedId, st.onImageLoad);
  }
}

export interface PreviewState {
  mover: Token;
  /** Legal destinations within remaining movement. */
  reachable: Point[];
  path: PathResult | null;
  target: Point | null;
}

/** Shade reachable squares and draw the hovered path with its cost. */
export function drawMovePreview(ctx: CanvasRenderingContext2D, v: Viewport, p: PreviewState): void {
  const s = footprintSquares(p.mover.size);
  const z = v.zoom;

  ctx.fillStyle = 'rgba(42, 36, 31, 0.09)';
  for (const q of p.reachable) ctx.fillRect(v.x + q.x * z, v.y + q.y * z, z, z);

  if (!p.path || !p.target || p.path.steps.length === 0) return;
  const center = (q: Point) => ({ x: v.x + (q.x + s / 2) * z, y: v.y + (q.y + s / 2) * z });
  const pts = [center(p.mover.position), ...p.path.steps.map(center)];
  const legal = p.path.legal;

  // Path line: solid ink when legal, dashed when not.
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(2, z * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!legal) ctx.setLineDash([z * 0.18, z * 0.14]);
  ctx.beginPath();
  pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
  ctx.stroke();
  ctx.setLineDash([]);

  // Step markers: dot for normal squares, hollow square for difficult terrain.
  p.path.steps.forEach((step, i) => {
    const q = pts[i + 1];
    const m = Math.max(3, z * 0.1);
    if (step.difficult) {
      ctx.fillStyle = INK.floor;
      ctx.fillRect(q.x - m, q.y - m, m * 2, m * 2);
      ctx.strokeStyle = INK.ink;
      ctx.lineWidth = Math.max(1.5, z * 0.04);
      ctx.strokeRect(q.x - m, q.y - m, m * 2, m * 2);
    } else {
      ctx.fillStyle = INK.ink;
      ctx.beginPath();
      ctx.arc(q.x, q.y, m * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Ghost outline at the destination
  const end = pts[pts.length - 1];
  const r = ((s * z) / 2) * 0.84;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(1.5, z * 0.05);
  ctx.setLineDash([z * 0.12, z * 0.1]);
  ctx.beginPath();
  ctx.arc(end.x, end.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!legal) {
    // Cross through the ghost: can't end here
    const k = r * 0.55;
    ctx.lineWidth = Math.max(2, z * 0.08);
    ctx.beginPath();
    ctx.moveTo(end.x - k, end.y - k);
    ctx.lineTo(end.x + k, end.y + k);
    ctx.moveTo(end.x + k, end.y - k);
    ctx.lineTo(end.x - k, end.y + k);
    ctx.stroke();
  }

  // Cost tag
  const text = Number.isFinite(p.path.totalFeet) ? `${p.path.totalFeet} ft` : 'no path';
  const fs = Math.max(11, Math.min(16, z * 0.35));
  ctx.font = `bold ${fs}px Georgia, 'Palatino Linotype', serif`;
  const tw = ctx.measureText(text).width;
  const tx = end.x + r + 6,
    ty = end.y - r - 4;
  ctx.fillStyle = INK.floor;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(tx - 5, ty - fs / 2 - 4, tw + 10, fs + 8, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tx, ty + 0.5);
}

/** Which token (topmost) covers a square, if any. */
export function tokenAt(tokens: Token[], cell: Point): Token | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const s = footprintSquares(t.size);
    if (cell.x >= t.position.x && cell.x < t.position.x + s && cell.y >= t.position.y && cell.y < t.position.y + s) return t;
  }
  return null;
}
