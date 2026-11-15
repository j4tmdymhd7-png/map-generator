/**
 * Pen-and-ink dungeon renderer.
 *
 * Draws a map onto a 2D canvas context in grid units scaled by `cell` pixels.
 * All hand-drawn wobble comes from a PRNG seeded by the map, in grid units,
 * so the same map looks identical at every zoom level and on every redraw.
 *
 * The look is monochrome on purpose: meaning is carried by line, pattern and
 * symbol, never by hue.
 */
import { idx, isDifficult, terrainAt } from '../core/model/grid';
import type { DoorState, DungeonMap, LootObject, RoomObject } from '../core/model/types';
import { createRng, type Rng } from '../core/rng';
import { doorOrientation, isOpenAt, rockDistance, wallSegments, type Segment } from './geometry';

export const INK = {
  paper: '#f2e8cf',
  floor: '#fbf6e8',
  ink: '#2a241f',
  shadow: 'rgba(42, 36, 31, 0.10)',
  grid: 'rgba(42, 36, 31, 0.16)',
  hatch: 'rgba(42, 36, 31, 0.78)',
} as const;

export interface InkOptions {
  /** Pixels per grid square. */
  cell: number;
  grid: boolean;
  roomNumbers: boolean;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function seedFor(map: DungeonMap): string {
  return `ink:${map.generation?.seed ?? map.id}`;
}

/** A slightly wobbly pen stroke from (x1,y1) to (x2,y2), in pixels. */
function penLine(ctx: Ctx, rng: Rng, x1: number, y1: number, x2: number, y2: number, wobble: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.round(len / (wobble * 40)));
  const nx = -(y2 - y1) / len,
    ny = (x2 - x1) / len;
  ctx.moveTo(x1 + (rng.next() - 0.5) * wobble, y1 + (rng.next() - 0.5) * wobble);
  let px = x1,
    py = y1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const off = i === steps ? 0 : (rng.next() - 0.5) * wobble;
    const qx = x1 + (x2 - x1) * t + nx * off;
    const qy = y1 + (y2 - y1) * t + ny * off;
    ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    ctx.lineTo(qx, qy);
    px = qx;
    py = qy;
  }
}

function drawPaper(ctx: Ctx, map: DungeonMap, c: number, rng: Rng) {
  const w = map.width * c,
    h = map.height * c;
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, w, h);
  // Faint mottling so the paper isn't flat.
  // Fine fibres/speckle rather than blotches, so it reads as paper grain.
  const specks = map.width * map.height * 3;
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = `rgba(110, 85, 50, ${0.04 + rng.next() * 0.06})`;
    const r = c * (0.015 + rng.next() * 0.03);
    ctx.fillRect(rng.next() * w, rng.next() * h, r, r);
  }
}

/** Crosshatch clusters in the rock that hugs the outside of the walls. */
function drawHatching(ctx: Ctx, map: DungeonMap, c: number, rng: Rng) {
  const dist = rockDistance(map, 3);
  const keep = [0, 1, 0.6, 0.18];
  ctx.strokeStyle = INK.hatch;
  ctx.lineWidth = Math.max(0.6, c * 0.035);
  ctx.lineCap = 'round';
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const d = dist[idx(map, x, y)];
      // Always roll, so the pattern doesn't shift when distances change elsewhere.
      const roll = rng.next();
      const angle = rng.next() * Math.PI;
      const jx = (rng.next() - 0.5) * 0.4,
        jy = (rng.next() - 0.5) * 0.4;
      const strokes = 4 + Math.floor(rng.next() * 3);
      if (d === 0 || d > 3 || roll > keep[d]) continue;

      const cx = (x + 0.5 + jx) * c,
        cy = (y + 0.5 + jy) * c;
      const r = c * 0.68;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const ux = Math.cos(angle),
        uy = Math.sin(angle);
      ctx.beginPath();
      for (let s = 0; s < strokes; s++) {
        const o = (s / (strokes - 1) - 0.5) * 2 * r * 0.85;
        const sx = cx - uy * o,
          sy = cy + ux * o;
        ctx.moveTo(sx - ux * r, sy - uy * r);
        ctx.lineTo(sx + ux * r, sy + uy * r);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

function openCellsPath(map: DungeonMap, c: number): Path2D {
  const p = new Path2D();
  for (let y = 0; y < map.height; y++) {
    let start = -1;
    for (let x = 0; x <= map.width; x++) {
      const open = x < map.width && isOpenAt(map, x, y);
      if (open && start < 0) start = x;
      if (!open && start >= 0) {
        p.rect(start * c, y * c, (x - start) * c, c);
        start = -1;
      }
    }
  }
  return p;
}

function drawFloor(ctx: Ctx, map: DungeonMap, c: number, open: Path2D, segments: Segment[], grid: boolean) {
  ctx.fillStyle = INK.floor;
  ctx.fill(open);

  ctx.save();
  ctx.clip(open);
  // Soft shadow inside every wall.
  ctx.fillStyle = INK.shadow;
  const s = c * 0.16;
  for (const g of segments) {
    if (g.y1 === g.y2) {
      const floorBelow = isOpenAt(map, g.x1, g.y1);
      ctx.fillRect(g.x1 * c, floorBelow ? g.y1 * c : g.y1 * c - s, (g.x2 - g.x1) * c, s);
    } else {
      const floorRight = isOpenAt(map, g.x1, g.y1);
      ctx.fillRect(floorRight ? g.x1 * c : g.x1 * c - s, g.y1 * c, s, (g.y2 - g.y1) * c);
    }
  }
  if (grid) {
    ctx.strokeStyle = INK.grid;
    ctx.lineWidth = Math.max(0.5, c * 0.025);
    ctx.setLineDash([c * 0.12, c * 0.1]);
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) {
      ctx.moveTo(x * c, 0);
      ctx.lineTo(x * c, map.height * c);
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.moveTo(0, y * c);
      ctx.lineTo(map.width * c, y * c);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawWalls(ctx: Ctx, c: number, segments: Segment[], rng: Rng) {
  ctx.strokeStyle = INK.ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Main stroke, then a thin offset pass for an inked, slightly doubled edge.
  for (const [width, alpha] of [
    [0.11, 1],
    [0.04, 0.45],
  ] as const) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, c * width);
    ctx.beginPath();
    for (const g of segments) penLine(ctx, rng, g.x1 * c, g.y1 * c, g.x2 * c, g.y2 * c, c * 0.05);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawDoor(ctx: Ctx, map: DungeonMap, x: number, y: number, state: DoorState, c: number) {
  const horizontal = doorOrientation(map, x, y) === 'horizontal';
  const cx = (x + 0.5) * c,
    cy = (y + 0.5) * c;
  ctx.save();
  ctx.translate(cx, cy);
  if (!horizontal) ctx.rotate(Math.PI / 2);
  // In this frame the door bar always runs left-right across the gap.
  const half = c * 0.5,
    t = c * 0.15;
  ctx.lineWidth = Math.max(1, c * 0.06);
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.floor;

  if (state === 'open') {
    // Open doorway: just the frame, a jamb block on each side.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(side < 0 ? -half : half - t * 1.6, -t, t * 1.6, t * 2);
      ctx.fillStyle = INK.ink;
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.rect(-half * 0.92, -t / 2, half * 1.84, t);
    ctx.fill();
    ctx.stroke();
    if (state === 'locked') {
      // Keyhole badge, centered over the leaf.
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = INK.ink;
      ctx.fill();
      ctx.fillStyle = INK.floor;
      ctx.beginPath();
      ctx.arc(0, -c * 0.03, c * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-c * 0.025, -c * 0.03, c * 0.05, c * 0.11);
    }
  }
  ctx.restore();
}

function drawStairs(ctx: Ctx, map: DungeonMap, x: number, y: number, c: number) {
  // Run the treads across the direction you'd walk in from (the more open axis).
  const lr = Number(isOpenAt(map, x - 1, y)) + Number(isOpenAt(map, x + 1, y));
  const ud = Number(isOpenAt(map, x, y - 1)) + Number(isOpenAt(map, x, y + 1));
  ctx.save();
  ctx.translate((x + 0.5) * c, (y + 0.5) * c);
  if (lr > ud) ctx.rotate(Math.PI / 2);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(1, c * 0.045);
  ctx.beginPath();
  const n = 5;
  for (let i = 0; i < n; i++) {
    const yy = -c * 0.38 + (i / (n - 1)) * c * 0.76;
    const w = c * (0.42 - i * 0.05);
    ctx.moveTo(-w, yy);
    ctx.lineTo(w, yy);
  }
  // Stringers
  ctx.moveTo(-c * 0.42, -c * 0.38);
  ctx.lineTo(-c * 0.22, c * 0.38);
  ctx.moveTo(c * 0.42, -c * 0.38);
  ctx.lineTo(c * 0.22, c * 0.38);
  ctx.stroke();
  ctx.restore();
}

function drawPit(ctx: Ctx, x: number, y: number, c: number) {
  const i = c * 0.12;
  const px = x * c + i,
    py = y * c + i,
    s = c - 2 * i;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, s, s);
  ctx.fillStyle = INK.floor;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(0.6, c * 0.035);
  ctx.beginPath();
  for (let k = -s; k < s; k += c * 0.11) {
    ctx.moveTo(px + k, py);
    ctx.lineTo(px + k + s, py + s);
    ctx.moveTo(px + k + s, py);
    ctx.lineTo(px + k, py + s);
  }
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = Math.max(1, c * 0.07);
  ctx.strokeStyle = INK.ink;
  ctx.strokeRect(px, py, s, s);
}

function drawHazard(ctx: Ctx, x: number, y: number, c: number) {
  const cx = (x + 0.5) * c,
    cy = (y + 0.5) * c;
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.ink;
  ctx.lineWidth = Math.max(1, c * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, cy - c * 0.34);
  ctx.lineTo(cx + c * 0.34, cy + c * 0.28);
  ctx.lineTo(cx - c * 0.34, cy + c * 0.28);
  ctx.closePath();
  ctx.stroke();
  ctx.font = `bold ${c * 0.42}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', cx, cy + c * 0.06);
}

function drawPillar(ctx: Ctx, x: number, y: number, c: number) {
  const cx = (x + 0.5) * c,
    cy = (y + 0.5) * c;
  ctx.beginPath();
  ctx.arc(cx, cy, c * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = INK.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - c * 0.1, cy - c * 0.1, c * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = INK.floor;
  ctx.fill();
}

/** Stippled rubble for Difficult Terrain. */
function drawRubble(ctx: Ctx, x: number, y: number, c: number, rng: Rng) {
  ctx.fillStyle = INK.ink;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(0.6, c * 0.03);
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc((x + 0.12 + rng.next() * 0.76) * c, (y + 0.12 + rng.next() * 0.76) * c, c * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const rx = (x + 0.2 + rng.next() * 0.6) * c,
      ry = (y + 0.2 + rng.next() * 0.6) * c;
    const r = c * (0.06 + rng.next() * 0.05);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const rr = r * (0.75 + rng.next() * 0.5);
      if (k === 0) ctx.moveTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr);
      else ctx.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/** A small inked chest; drawn with the lid thrown back once it's been emptied. */
function drawLoot(ctx: Ctx, loot: LootObject, c: number) {
  const cx = (loot.at.x + 0.5) * c,
    cy = (loot.at.y + 0.5) * c;
  const empty = loot.items.length === 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.floor;
  ctx.lineWidth = Math.max(1, c * 0.055);
  ctx.lineJoin = 'round';
  if (loot.container === 'pile') {
    // A heap of coins and odds and ends
    for (const [dx, dy, r] of [
      [-0.14, 0.08, 0.13],
      [0.12, 0.1, 0.12],
      [0, -0.08, 0.14],
    ] as const) {
      ctx.beginPath();
      ctx.arc(dx * c, dy * c, r * c, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const w = c * 0.62,
    h = c * 0.4;
  // Body
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2 + c * 0.06, w, h);
  ctx.fill();
  ctx.stroke();
  if (empty) {
    // Lid thrown back
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2 - c * 0.14, w, c * 0.18);
    ctx.setLineDash([c * 0.06, c * 0.05]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Lid band and clasp
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + c * 0.2);
    ctx.lineTo(w / 2, -h / 2 + c * 0.2);
    ctx.stroke();
    ctx.fillStyle = INK.ink;
    ctx.fillRect(-c * 0.05, -h / 2 + c * 0.15, c * 0.1, c * 0.12);
  }
  ctx.restore();
}

function drawFeatures(ctx: Ctx, map: DungeonMap, c: number, rng: Rng) {
  const doors = new Map<number, DoorState>();
  for (const o of map.objects) if (o.kind === 'door') doors.set(idx(map, o.at.x, o.at.y), o.state);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = terrainAt(map, x, y);
      if (isDifficult(map, x, y)) drawRubble(ctx, x, y, c, rng);
      switch (t) {
        case 'door':
          drawDoor(ctx, map, x, y, doors.get(idx(map, x, y)) ?? 'closed', c);
          break;
        case 'stairs':
          drawStairs(ctx, map, x, y, c);
          break;
        case 'pit':
          drawPit(ctx, x, y, c);
          break;
        case 'hazard':
          drawHazard(ctx, x, y, c);
          break;
        case 'obstacle':
          drawPillar(ctx, x, y, c);
          break;
        default:
          break;
      }
    }
  }
  for (const o of map.objects) if (o.kind === 'loot') drawLoot(ctx, o, c);
}

function drawRoomNumbers(ctx: Ctx, map: DungeonMap, c: number) {
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room' && o.visibility === 'public');
  ctx.font = `italic bold ${Math.round(c * 0.62)}px Georgia, 'Palatino Linotype', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  rooms.forEach((r, i) => {
    const label = String(i + 1);
    let cx = (r.rect.x + r.rect.w / 2) * c;
    let cy = (r.rect.y + r.rect.h / 2) * c;
    // Nudge off a stairs square so the number doesn't sit on top of it.
    const sx = Math.floor(cx / c),
      sy = Math.floor(cy / c);
    if (terrainAt(map, sx, sy) === 'stairs') cy -= c * 0.9;
    if (r.rect.w % 2 === 1) cx = (Math.floor(cx / c) + 0.5) * c;
    ctx.lineWidth = c * 0.18;
    ctx.strokeStyle = INK.floor;
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = INK.ink;
    ctx.fillText(label, cx, cy);
  });
}

/** Draw the whole static map (everything that doesn't move during play). */
export function drawInkMap(ctx: Ctx, map: DungeonMap, opts: InkOptions): void {
  const c = opts.cell;
  const segments = wallSegments(map);
  const open = openCellsPath(map, c);
  // Separate streams so toggling one layer never reshuffles another's wobble.
  const seed = seedFor(map);
  drawPaper(ctx, map, c, createRng(`${seed}:paper`));
  drawHatching(ctx, map, c, createRng(`${seed}:hatch`));
  drawFloor(ctx, map, c, open, segments, opts.grid);
  drawFeatures(ctx, map, c, createRng(`${seed}:features`));
  drawWalls(ctx, c, segments, createRng(`${seed}:walls`));
  if (opts.roomNumbers) drawRoomNumbers(ctx, map, c);
}
