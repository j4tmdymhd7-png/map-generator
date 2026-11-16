/**
 * Pen-and-ink map renderer.
 *
 * Draws any rectangle of a map (a tile) onto a 2D canvas, in grid units
 * scaled by `cell` pixels. Every bit of hand-drawn wobble comes from a hash of
 * the map seed and the square (or wall stroke) being drawn, so any tile, at
 * any zoom, draws exactly the same as its neighbours and as the whole map.
 *
 * The look is monochrome on purpose: meaning is carried by line, pattern and
 * symbol, never by hue.
 */
import { idx, isDifficult, terrainAt } from '../core/model/grid';
import type { DoorState, DungeonMap, FurnitureObject, LootObject, MapStyle, RoomObject, StructureObject, Terrain } from '../core/model/types';
import { doorOrientation, isOpenAt, rockDistance, wallSegments, type Segment } from './geometry';

export const INK = {
  paper: '#f2e8cf',
  floor: '#fbf6e8',
  road: '#ece2c8',
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

/** Squares [x0, x1) × [y0, y1). */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type R = () => number;

// ---------------------------------------------------------------------------
// Deterministic per-square randomness

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small PRNG (mulberry32) seeded from the map seed, a salt and a position. */
function rngAt(seed: number, salt: number, x: number, y: number): R {
  let a = (seed ^ Math.imul(salt + 1, 0x9e3779b1) ^ Math.imul(x + 7919, 0x85ebca6b) ^ Math.imul(y + 104729, 0xc2b2ae35)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SALT = { paper: 1, hatch: 2, wall: 3, rubble: 4, brush: 5, grass: 6, road: 7, water: 8, tree: 9 } as const;

// ---------------------------------------------------------------------------
// Per-map data, computed once

interface Pre {
  seed: number;
  style: MapStyle;
  segments: Segment[];
  roadEdges: Segment[];
  rockDist: Uint8Array;
  doors: Map<number, DoorState>;
  furnitureCells: Set<number>;
  furniture: FurnitureObject[];
  structures: StructureObject[];
  /** Squares covered by a drawn structure (no generic rock hatching there). */
  structureCells: Set<number>;
  loot: LootObject[];
  rooms: RoomObject[];
}

const preCache = new WeakMap<DungeonMap, Pre>();

/** Lines along the edge between two kinds of squares, merged into long runs. */
function edgeSegments(map: DungeonMap, inside: (t: Terrain) => boolean, outside: (t: Terrain) => boolean): Segment[] {
  const out: Segment[] = [];
  const edgeAt = (a: Terrain, b: Terrain) => (inside(a) && outside(b)) || (inside(b) && outside(a));
  for (let y = 1; y < map.height; y++) {
    let run = -1;
    for (let x = 0; x <= map.width; x++) {
      const e = x < map.width && edgeAt(terrainAt(map, x, y - 1), terrainAt(map, x, y));
      if (e && run < 0) run = x;
      if (!e && run >= 0) {
        out.push({ x1: run, y1: y, x2: x, y2: y });
        run = -1;
      }
    }
  }
  for (let x = 1; x < map.width; x++) {
    let run = -1;
    for (let y = 0; y <= map.height; y++) {
      const e = y < map.height && edgeAt(terrainAt(map, x - 1, y), terrainAt(map, x, y));
      if (e && run < 0) run = y;
      if (!e && run >= 0) {
        out.push({ x1: x, y1: run, x2: x, y2: y });
        run = -1;
      }
    }
  }
  return out;
}

function pre(map: DungeonMap): Pre {
  let p = preCache.get(map);
  if (p) return p;
  const furniture = map.objects.filter((o): o is FurnitureObject => o.kind === 'furniture');
  const furnitureCells = new Set<number>();
  for (const f of furniture)
    for (let y = f.rect.y; y < f.rect.y + f.rect.h; y++) for (let x = f.rect.x; x < f.rect.x + f.rect.w; x++) furnitureCells.add(idx(map, x, y));
  const structures = map.objects.filter((o): o is StructureObject => o.kind === 'structure');
  const structureCells = new Set<number>();
  for (const st of structures)
    for (let y = st.rect.y; y < st.rect.y + st.rect.h; y++)
      for (let x = st.rect.x; x < st.rect.x + st.rect.w; x++) if (x >= 0 && y >= 0 && x < map.width && y < map.height) structureCells.add(idx(map, x, y));
  const doors = new Map<number, DoorState>();
  for (const o of map.objects) if (o.kind === 'door') doors.set(idx(map, o.at.x, o.at.y), o.state);
  const style = map.style ?? 'dungeon';
  const ground = (t: Terrain) => t === 'ground' || t === 'brush' || t === 'tree';
  p = {
    seed: hashString(`ink:${map.generation?.seed ?? map.id}`),
    style,
    segments: wallSegments(map),
    roadEdges: style === 'outdoor' ? edgeSegments(map, (t) => t === 'road', ground) : [],
    rockDist: rockDistance(map, 3),
    doors,
    furnitureCells,
    furniture,
    structures,
    structureCells,
    loot: map.objects.filter((o): o is LootObject => o.kind === 'loot'),
    rooms: map.objects.filter((o): o is RoomObject => o.kind === 'room' && o.visibility === 'public'),
  };
  preCache.set(map, p);
  return p;
}

/** A slightly wobbly pen stroke from (x1,y1) to (x2,y2), in pixels. */
function penLine(ctx: Ctx, rng: R, x1: number, y1: number, x2: number, y2: number, wobble: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.round(len / (wobble * 40)));
  const nx = -(y2 - y1) / len,
    ny = (x2 - x1) / len;
  ctx.moveTo(x1 + (rng() - 0.5) * wobble, y1 + (rng() - 0.5) * wobble);
  let px = x1,
    py = y1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const off = i === steps ? 0 : (rng() - 0.5) * wobble;
    const qx = x1 + (x2 - x1) * t + nx * off;
    const qy = y1 + (y2 - y1) * t + ny * off;
    ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    ctx.lineTo(qx, qy);
    px = qx;
    py = qy;
  }
}

const segRng = (p: Pre, g: Segment) => rngAt(p.seed, SALT.wall, g.x1 * 1009 + g.x2, g.y1 * 1013 + g.y2);
const segIn = (g: Segment, r: Region) => g.x2 >= r.x0 - 1 && g.x1 <= r.x1 + 1 && g.y2 >= r.y0 - 1 && g.y1 <= r.y1 + 1;

// ---------------------------------------------------------------------------
// Layers

function forCells(map: DungeonMap, r: Region, margin: number, fn: (x: number, y: number, i: number) => void) {
  const x0 = Math.max(0, r.x0 - margin),
    y0 = Math.max(0, r.y0 - margin),
    x1 = Math.min(map.width, r.x1 + margin),
    y1 = Math.min(map.height, r.y1 + margin);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(x, y, idx(map, x, y));
}

function drawPaper(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region) {
  ctx.fillStyle = INK.paper;
  ctx.fillRect(r.x0 * c, r.y0 * c, (r.x1 - r.x0) * c, (r.y1 - r.y0) * c);
  forCells(map, r, 0, (x, y) => {
    const rng = rngAt(p.seed, SALT.paper, x, y);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = `rgba(110, 85, 50, ${0.04 + rng() * 0.06})`;
      const s = c * (0.015 + rng() * 0.03);
      ctx.fillRect((x + rng()) * c, (y + rng()) * c, s, s);
    }
  });
}

/** Crosshatch in the rock around walls (dungeons), on walls (interiors), and over whole buildings (outdoors). */
function drawHatching(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region) {
  const keep = p.style === 'dungeon' ? [0, 1, 0.6, 0.18, 0] : p.style === 'interior' ? [0, 1, 0, 0, 0] : [0, 1, 1, 1, 1];
  ctx.strokeStyle = p.style === 'outdoor' ? 'rgba(42, 36, 31, 0.6)' : INK.hatch;
  ctx.lineWidth = Math.max(0.6, c * 0.035);
  ctx.lineCap = 'round';
  forCells(map, r, 1, (x, y, i) => {
    const d = p.rockDist[i];
    if (d === 0 || p.structureCells.has(i)) return;
    const rng = rngAt(p.seed, SALT.hatch, x, y);
    if (rng() > keep[Math.min(d, 4)]) return;
    const angle = rng() * Math.PI;
    const jx = (rng() - 0.5) * 0.4,
      jy = (rng() - 0.5) * 0.4;
    const strokes = 4 + Math.floor(rng() * 3);
    const cx = (x + 0.5 + jx) * c,
      cy = (y + 0.5 + jy) * c;
    const rad = c * 0.68;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.clip();
    const ux = Math.cos(angle),
      uy = Math.sin(angle);
    ctx.beginPath();
    for (let s = 0; s < strokes; s++) {
      const o = (s / (strokes - 1) - 0.5) * 2 * rad * 0.85;
      const sx = cx - uy * o,
        sy = cy + ux * o;
      ctx.moveTo(sx - ux * rad, sy - uy * rad);
      ctx.lineTo(sx + ux * rad, sy + uy * rad);
    }
    ctx.stroke();
    ctx.restore();
  });
}

function drawFloor(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region, grid: boolean) {
  // Open squares in this region, as one path (rows of runs).
  const open = new Path2D();
  for (let y = Math.max(0, r.y0 - 1); y < Math.min(map.height, r.y1 + 1); y++) {
    let start = -1;
    for (let x = Math.max(0, r.x0 - 1); x <= Math.min(map.width, r.x1 + 1); x++) {
      const o = x < Math.min(map.width, r.x1 + 1) && isOpenAt(map, x, y);
      if (o && start < 0) start = x;
      if (!o && start >= 0) {
        open.rect(start * c, y * c, (x - start) * c, c);
        start = -1;
      }
    }
  }
  ctx.fillStyle = INK.floor;
  ctx.fill(open);
  ctx.save();
  ctx.clip(open);
  // Roads are a shade darker than open ground.
  if (p.style !== 'dungeon') {
    ctx.fillStyle = INK.road;
    forCells(map, r, 1, (x, y, i) => {
      if (map.terrain[i] === 'road') ctx.fillRect(x * c, y * c, c, c);
    });
  }
  // Soft shadow inside every wall.
  ctx.fillStyle = INK.shadow;
  const s = c * 0.16;
  for (const g of p.segments) {
    if (!segIn(g, r)) continue;
    if (g.y1 === g.y2) {
      const below = isOpenAt(map, g.x1, g.y1);
      ctx.fillRect(g.x1 * c, below ? g.y1 * c : g.y1 * c - s, (g.x2 - g.x1) * c, s);
    } else {
      const right = isOpenAt(map, g.x1, g.y1);
      ctx.fillRect(right ? g.x1 * c : g.x1 * c - s, g.y1 * c, s, (g.y2 - g.y1) * c);
    }
  }
  if (grid) {
    ctx.strokeStyle = INK.grid;
    ctx.lineWidth = Math.max(0.5, c * 0.025);
    ctx.setLineDash([c * 0.12, c * 0.1]);
    ctx.beginPath();
    for (let x = r.x0; x <= r.x1; x++) {
      ctx.moveTo(x * c, r.y0 * c);
      ctx.lineTo(x * c, r.y1 * c);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      ctx.moveTo(r.x0 * c, y * c);
      ctx.lineTo(r.x1 * c, y * c);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawWalls(ctx: Ctx, p: Pre, c: number, r: Region) {
  ctx.strokeStyle = INK.ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Main stroke, then a thin offset pass for an inked, slightly doubled edge.
  for (const [width, alpha, pass] of [
    [0.11, 1, 0],
    [0.04, 0.45, 1],
  ] as const) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, c * width);
    ctx.beginPath();
    const endpointMap = new Map<string, { x: number; y: number; horizontal: boolean; other: { x: number; y: number } }[]>();
    const key = (x: number, y: number) => `${x},${y}`;
    for (const g of p.segments) {
      const horizontal = g.y1 === g.y2;
      for (const [x, y, ox, oy] of [[g.x1, g.y1, g.x2, g.y2], [g.x2, g.y2, g.x1, g.y1]]) {
        const k = key(x, y), items = endpointMap.get(k) ?? [];
        items.push({ x, y, horizontal, other: { x: ox, y: oy } }); endpointMap.set(k, items);
      }
    }
    const corners = [...endpointMap.values()].flatMap((ends) => {
      const h = ends.find((e) => e.horizontal), v = ends.find((e) => !e.horizontal);
      return h && v ? [{ x: h.x, y: h.y, ends: [h.other, v.other] }] : [];
    });
    const cornerEnds = new Set(corners.map((corner) => key(corner.x, corner.y)));
    for (const g of p.segments) {
      if (!segIn(g, r)) continue;
      const rng = segRng(p, g);
      if (pass === 1) for (let k = 0; k < 64; k++) rng(); // a different wobble for the second pass
      const trim = c * 0.2;
      const atCorner = (x: number, y: number) => cornerEnds.has(key(x, y));
      const horizontal = g.y1 === g.y2;
      const x1 = g.x1 + (atCorner(g.x1, g.y1) ? trim / c : 0) * (horizontal ? 1 : 0);
      const x2 = g.x2 - (atCorner(g.x2, g.y2) ? trim / c : 0) * (horizontal ? 1 : 0);
      const y1 = g.y1 + (atCorner(g.x1, g.y1) ? trim / c : 0) * (horizontal ? 0 : 1);
      const y2 = g.y2 - (atCorner(g.x2, g.y2) ? trim / c : 0) * (horizontal ? 0 : 1);
      penLine(ctx, rng, x1 * c, y1 * c, x2 * c, y2 * c, c * 0.025);
    }
    for (const corner of corners) {
      if (corner.x < r.x0 - 1 || corner.x > r.x1 + 1 || corner.y < r.y0 - 1 || corner.y > r.y1 + 1) continue;
      const ends = corner.ends;
      if (ends.length !== 2) continue;
      ctx.moveTo((corner.x + (ends[0].x - corner.x) * 0.2) * c, (corner.y + (ends[0].y - corner.y) * 0.2) * c);
      ctx.quadraticCurveTo(corner.x * c, corner.y * c, (corner.x + (ends[1].x - corner.x) * 0.2) * c, (corner.y + (ends[1].y - corner.y) * 0.2) * c);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRoadEdges(ctx: Ctx, p: Pre, c: number, r: Region) {
  if (!p.roadEdges.length) return;
  ctx.strokeStyle = 'rgba(42, 36, 31, 0.55)';
  ctx.lineWidth = Math.max(0.7, c * 0.035);
  ctx.setLineDash([c * 0.22, c * 0.12]);
  ctx.beginPath();
  for (const g of p.roadEdges) {
    if (!segIn(g, r)) continue;
    penLine(ctx, segRng(p, g), g.x1 * c, g.y1 * c, g.x2 * c, g.y2 * c, c * 0.06);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Terrain details

/** Stippled rubble for Difficult Terrain. */
function drawRubble(ctx: Ctx, x: number, y: number, c: number, rng: R) {
  ctx.fillStyle = INK.ink;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(0.6, c * 0.03);
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc((x + 0.12 + rng() * 0.76) * c, (y + 0.12 + rng() * 0.76) * c, c * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const rx = (x + 0.2 + rng() * 0.6) * c,
      ry = (y + 0.2 + rng() * 0.6) * c;
    const rad = c * (0.06 + rng() * 0.05);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const rr = rad * (0.75 + rng() * 0.5);
      if (k === 0) ctx.moveTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr);
      else ctx.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/** A few tufts of undergrowth: curved blades fanning up from the ground. */
function drawBrush(ctx: Ctx, x: number, y: number, c: number, rng: R) {
  ctx.strokeStyle = 'rgba(42, 36, 31, 0.8)';
  ctx.lineWidth = Math.max(0.7, c * 0.035);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const tufts = 2 + Math.floor(rng() * 2);
  for (let t = 0; t < tufts; t++) {
    const bx = (x + 0.2 + rng() * 0.6) * c,
      by = (y + 0.5 + rng() * 0.35) * c;
    for (let k = -2; k <= 2; k++) {
      const h = c * (0.16 + (2 - Math.abs(k)) * 0.04 + rng() * 0.04);
      ctx.moveTo(bx + k * c * 0.02, by);
      ctx.quadraticCurveTo(bx + k * c * 0.03, by - h * 0.7, bx + k * c * 0.08, by - h);
    }
  }
  ctx.stroke();
}

function drawGrass(ctx: Ctx, x: number, y: number, c: number, rng: R) {
  if (rng() > 0.18) return;
  ctx.strokeStyle = 'rgba(42, 36, 31, 0.55)';
  ctx.lineWidth = Math.max(0.6, c * 0.03);
  ctx.beginPath();
  const bx = (x + 0.2 + rng() * 0.6) * c,
    by = (y + 0.3 + rng() * 0.5) * c;
  ctx.moveTo(bx - c * 0.07, by - c * 0.1);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + c * 0.07, by - c * 0.12);
  ctx.stroke();
}

function drawRoadPebbles(ctx: Ctx, x: number, y: number, c: number, rng: R) {
  if (rng() > 0.35) return;
  ctx.strokeStyle = 'rgba(42, 36, 31, 0.4)';
  ctx.lineWidth = Math.max(0.5, c * 0.025);
  ctx.beginPath();
  ctx.ellipse((x + 0.2 + rng() * 0.6) * c, (y + 0.2 + rng() * 0.6) * c, c * 0.07, c * 0.045, rng() * Math.PI, 0, Math.PI * 2);
  ctx.stroke();
}

function drawWater(ctx: Ctx, x: number, y: number, deep: boolean, c: number, rng: R) {
  ctx.fillStyle = deep ? 'rgba(42, 36, 31, 0.2)' : 'rgba(42, 36, 31, 0.07)';
  ctx.fillRect(x * c, y * c, c, c);
  ctx.strokeStyle = deep ? 'rgba(42, 36, 31, 0.75)' : 'rgba(42, 36, 31, 0.55)';
  ctx.lineWidth = Math.max(0.6, c * 0.035);
  ctx.beginPath();
  const lines = deep ? 3 : 2;
  for (let k = 0; k < lines; k++) {
    const yy = (y + (k + 0.5) / lines + (rng() - 0.5) * 0.1) * c;
    const x0 = (x + 0.08 + rng() * 0.2) * c,
      w = c * (0.45 + rng() * 0.25);
    ctx.moveTo(x0, yy);
    ctx.bezierCurveTo(x0 + w * 0.25, yy - c * 0.08, x0 + w * 0.5, yy + c * 0.08, x0 + w * 0.75, yy);
    ctx.quadraticCurveTo(x0 + w * 0.875, yy - c * 0.04, x0 + w, yy);
  }
  ctx.stroke();
}

/** A tree from above: a lobed canopy with a soft shadow. */
function drawTree(ctx: Ctx, x: number, y: number, c: number, rng: R) {
  const cx = (x + 0.5 + (rng() - 0.5) * 0.25) * c,
    cy = (y + 0.5 + (rng() - 0.5) * 0.25) * c;
  const rad = c * (0.55 + rng() * 0.12);
  const lobes = 7 + Math.floor(rng() * 3);
  const ph = rng() * Math.PI * 2;
  const canopy = () => {
    ctx.beginPath();
    for (let k = 0; k <= lobes; k++) {
      const a = ph + (k / lobes) * Math.PI * 2;
      const a2 = ph + ((k + 0.5) / lobes) * Math.PI * 2;
      const px = cx + Math.cos(a) * rad * 0.82,
        py = cy + Math.sin(a) * rad * 0.82;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.quadraticCurveTo(cx + Math.cos(a2 - Math.PI / lobes) * rad * 1.08, cy + Math.sin(a2 - Math.PI / lobes) * rad * 1.08, px, py);
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(c * 0.08, c * 0.1);
  canopy();
  ctx.fillStyle = 'rgba(42, 36, 31, 0.18)';
  ctx.fill();
  ctx.restore();
  canopy();
  ctx.fillStyle = INK.floor;
  ctx.fill();
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(0.8, c * 0.05);
  ctx.stroke();
  // Shading on the lower-right of the canopy, and a dot for the trunk.
  ctx.lineWidth = Math.max(0.5, c * 0.03);
  ctx.beginPath();
  const a0 = 0.15 + rng() * 0.3;
  ctx.arc(cx, cy, rad * 0.62, a0, a0 + 1.4);
  ctx.stroke();
  ctx.fillStyle = INK.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.8, c * 0.045), 0, Math.PI * 2);
  ctx.fill();
}

function drawFurniture(ctx: Ctx, f: FurnitureObject, c: number) {
  const { x, y, w, h } = f.rect;
  const px = x * c,
    py = y * c,
    pw = w * c,
    ph = h * c;
  ctx.save();
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.floor;
  ctx.lineWidth = Math.max(1, c * 0.05);
  const box = (i: number) => {
    ctx.beginPath();
    ctx.rect(px + i * c, py + i * c, pw - 2 * i * c, ph - 2 * i * c);
    ctx.fill();
    ctx.stroke();
  };
  const horizontal = w >= h;
  switch (f.type) {
    case 'table': {
      ctx.lineWidth = Math.max(0.5, c * 0.025);
      if (Math.max(w, h) <= Math.min(w, h) * 1.35) {
        const cx = px + pw / 2;
        const cy = py + ph / 2;
        const rx = pw * 0.4;
        const ry = ph * 0.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = Math.max(0.4, c * 0.018);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.78, ry * 0.78, 0, 0, Math.PI * 2);
        ctx.moveTo(cx - rx * 0.58, cy);
        ctx.lineTo(cx + rx * 0.58, cy);
        ctx.moveTo(cx, cy - ry * 0.58);
        ctx.lineTo(cx, cy + ry * 0.58);
        ctx.stroke();
      } else {
        box(0.14);
        ctx.beginPath();
        for (let k = 1; k < 3; k++) {
          if (horizontal) {
            ctx.moveTo(px + 0.14 * c, py + 0.14 * c + ((ph - 0.28 * c) * k) / 3);
            ctx.lineTo(px + pw - 0.14 * c, py + 0.14 * c + ((ph - 0.28 * c) * k) / 3);
          } else {
            ctx.moveTo(px + 0.14 * c + ((pw - 0.28 * c) * k) / 3, py + 0.14 * c);
            ctx.lineTo(px + 0.14 * c + ((pw - 0.28 * c) * k) / 3, py + ph - 0.14 * c);
          }
        }
        ctx.stroke();
      }
      break;
    }
    case 'bed': {
      box(0.1);
      ctx.beginPath();
      if (horizontal) ctx.rect(px + 0.16 * c, py + 0.18 * c, 0.4 * c, ph - 0.36 * c);
      else ctx.rect(px + 0.18 * c, py + 0.16 * c, pw - 0.36 * c, 0.4 * c);
      ctx.stroke();
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(px + 0.75 * c, py + 0.1 * c);
        ctx.lineTo(px + 0.75 * c, py + ph - 0.1 * c);
      } else {
        ctx.moveTo(px + 0.1 * c, py + 0.75 * c);
        ctx.lineTo(px + pw - 0.1 * c, py + 0.75 * c);
      }
      ctx.stroke();
      break;
    }
    case 'counter':
    case 'shelf': {
      box(f.type === 'counter' ? 0.08 : 0.12);
      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 0.12 * c, py + 0.12 * c, pw - 0.24 * c, ph - 0.24 * c);
      ctx.clip();
      ctx.lineWidth = Math.max(0.5, c * 0.025);
      ctx.beginPath();
      if (f.type === 'counter') {
        for (let k = -ph; k < pw; k += c * 0.16) {
          ctx.moveTo(px + k, py + ph);
          ctx.lineTo(px + k + ph, py);
        }
      } else if (horizontal) {
        ctx.moveTo(px, py + ph / 2);
        ctx.lineTo(px + pw, py + ph / 2);
      } else {
        ctx.moveTo(px + pw / 2, py);
        ctx.lineTo(px + pw / 2, py + ph);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'barrel': {
      const cx = px + pw / 2,
        cy = py + ph / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = Math.max(0.5, c * 0.025);
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'hearth': {
      box(0.06);
      ctx.fillStyle = INK.ink;
      const cx = px + pw / 2,
        cy = py + ph / 2;
      ctx.beginPath();
      ctx.moveTo(cx - c * 0.18, cy + c * 0.18);
      ctx.quadraticCurveTo(cx - c * 0.2, cy - c * 0.05, cx - c * 0.05, cy - c * 0.25);
      ctx.quadraticCurveTo(cx - c * 0.02, cy - c * 0.05, cx + c * 0.06, cy - c * 0.12);
      ctx.quadraticCurveTo(cx + c * 0.22, cy + c * 0.02, cx + c * 0.18, cy + c * 0.18);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'stall': {
      box(0.08);
      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 0.08 * c, py + 0.08 * c, pw - 0.16 * c, ph - 0.16 * c);
      ctx.clip();
      ctx.fillStyle = 'rgba(42, 36, 31, 0.55)';
      for (let k = 0; k < (horizontal ? w : h) * 4; k += 2) {
        if (horizontal) ctx.fillRect(px + k * c * 0.25, py, c * 0.25, ph);
        else ctx.fillRect(px, py + k * c * 0.25, pw, c * 0.25);
      }
      ctx.restore();
      break;
    }
    case 'chair': {
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const radius = Math.min(pw, ph) * 0.28;
      const angle = f.facing === 'west' ? Math.PI / 2 : f.facing === 'north' ? Math.PI : f.facing === 'east' ? -Math.PI / 2 : 0;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.arc(0, c * 0.05, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-radius * 0.82, -radius * 0.55);
      ctx.lineTo(-radius * 0.82, -radius * 1.5);
      ctx.quadraticCurveTo(0, -radius * 1.85, radius * 0.82, -radius * 1.5);
      ctx.lineTo(radius * 0.82, -radius * 0.55);
      ctx.stroke();
      break;
    }
    case 'bench': {
      box(0.12);
      ctx.lineWidth = Math.max(0.5, c * 0.025);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(px, py + ph * 0.35);
        ctx.lineTo(px + pw, py + ph * 0.35);
        ctx.moveTo(px, py + ph * 0.68);
        ctx.lineTo(px + pw, py + ph * 0.68);
      } else {
        ctx.moveTo(px + pw * 0.35, py);
        ctx.lineTo(px + pw * 0.35, py + ph);
        ctx.moveTo(px + pw * 0.68, py);
        ctx.lineTo(px + pw * 0.68, py + ph);
      }
      ctx.stroke();
      break;
    }
    case 'cabinet': {
      box(0.1);
      ctx.lineWidth = Math.max(0.5, c * 0.025);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(px + pw / 2, py + c * 0.12);
        ctx.lineTo(px + pw / 2, py + ph - c * 0.12);
        ctx.arc(px + pw * 0.42, py + ph / 2, c * 0.035, 0, Math.PI * 2);
        ctx.arc(px + pw * 0.58, py + ph / 2, c * 0.035, 0, Math.PI * 2);
      } else {
        ctx.moveTo(px + c * 0.12, py + ph / 2);
        ctx.lineTo(px + pw - c * 0.12, py + ph / 2);
        ctx.arc(px + pw / 2, py + ph * 0.42, c * 0.035, 0, Math.PI * 2);
        ctx.arc(px + pw / 2, py + ph * 0.58, c * 0.035, 0, Math.PI * 2);
      }
      ctx.stroke();
      break;
    }
    case 'rug': {
      ctx.fillStyle = 'rgba(42, 36, 31, 0.04)';
      ctx.strokeStyle = INK.ink;
      ctx.lineWidth = Math.max(0.6, c * 0.035);
      const inset = c * 0.12;
      ctx.beginPath();
      ctx.roundRect(px + inset, py + inset, pw - inset * 2, ph - inset * 2, Math.min(c * 0.22, Math.min(pw, ph) * 0.12));
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = Math.max(0.4, c * 0.018);
      ctx.beginPath();
      ctx.roundRect(px + inset * 2.2, py + inset * 2.2, pw - inset * 4.4, ph - inset * 4.4, Math.min(c * 0.14, Math.min(pw, ph) * 0.08));
      ctx.stroke();
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - c * 0.16);
      ctx.lineTo(cx + c * 0.16, cy);
      ctx.lineTo(cx, cy + c * 0.16);
      ctx.lineTo(cx - c * 0.16, cy);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'well': {
      const cx = px + pw / 2,
        cy = py + ph / 2;
      ctx.lineWidth = Math.max(1.5, c * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(42, 36, 31, 0.45)';
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
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


const ROOF = '#e4d8bb';
const STONE = '#cbbd9c';

/** A hip roof seen from above: ridge along the long side, hips to the corners, shading on two slopes. */
function drawRoof(ctx: Ctx, rect: { x: number; y: number; w: number; h: number }, c: number) {
  const x0 = rect.x * c,
    y0 = rect.y * c,
    w = rect.w * c,
    h = rect.h * c;
  ctx.fillStyle = ROOF;
  const radius = Math.min(c * 0.55, w * 0.16, h * 0.16);
  ctx.beginPath();
  ctx.moveTo(x0 + radius, y0);
  ctx.lineTo(x0 + w - radius, y0);
  ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + radius);
  ctx.lineTo(x0 + w, y0 + h - radius);
  ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - radius, y0 + h);
  ctx.lineTo(x0 + radius, y0 + h);
  ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - radius);
  ctx.lineTo(x0, y0 + radius);
  ctx.quadraticCurveTo(x0, y0, x0 + radius, y0);
  ctx.closePath();
  ctx.fill();
  const horizontal = w >= h;
  const half = (horizontal ? h : w) / 2;
  // Ridge end points
  const r1 = horizontal ? { x: x0 + half, y: y0 + half } : { x: x0 + half, y: y0 + half };
  const r2 = horizontal ? { x: x0 + w - half, y: y0 + half } : { x: x0 + half, y: y0 + h - half };
  // Shade the two "south/east" slopes with fine parallel lines.
  ctx.save();
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(x0, y0 + h);
    ctx.lineTo(r1.x, r1.y);
    ctx.lineTo(r2.x, r2.y);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
    ctx.moveTo(x0 + w, y0);
    ctx.lineTo(r2.x, r2.y);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
  } else {
    ctx.moveTo(x0 + w, y0);
    ctx.lineTo(r1.x, r1.y);
    ctx.lineTo(r2.x, r2.y);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
    ctx.moveTo(x0, y0 + h);
    ctx.lineTo(r2.x, r2.y);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
  }
  ctx.clip();
  ctx.strokeStyle = 'rgba(42, 36, 31, 0.45)';
  ctx.lineWidth = Math.max(0.5, c * 0.025);
  ctx.beginPath();
  const step = c * 0.22;
  if (horizontal)
    for (let yy = y0 + step / 2; yy < y0 + h; yy += step) {
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + w, yy);
    }
  else
    for (let xx = x0 + step / 2; xx < x0 + w; xx += step) {
      ctx.moveTo(xx, y0);
      ctx.lineTo(xx, y0 + h);
    }
  ctx.stroke();
  ctx.restore();
  // Ridge and hips
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(0.7, c * 0.04);
  ctx.beginPath();
  ctx.moveTo(r1.x, r1.y);
  ctx.lineTo(r2.x, r2.y);
  ctx.moveTo(x0, y0);
  ctx.lineTo(r1.x, r1.y);
  ctx.lineTo(horizontal ? x0 : x0 + w, horizontal ? y0 + h : y0);
  ctx.moveTo(x0 + w, y0 + h);
  ctx.lineTo(r2.x, r2.y);
  ctx.lineTo(horizontal ? x0 + w : x0, horizontal ? y0 : y0 + h);
  ctx.stroke();
  // Own outline, so neighbouring houses stay distinct.
  ctx.lineWidth = Math.max(0.8, c * 0.05);
  ctx.strokeRect(x0, y0, w, h);
}

/** City wall: dressed stone, coursed along its length. */
function drawWallStones(ctx: Ctx, map: DungeonMap, st: StructureObject, c: number, r: Region) {
  const horizontal = st.rect.w >= st.rect.h;
  for (let y = Math.max(st.rect.y, r.y0 - 1); y < Math.min(st.rect.y + st.rect.h, r.y1 + 1); y++)
    for (let x = Math.max(st.rect.x, r.x0 - 1); x < Math.min(st.rect.x + st.rect.w, r.x1 + 1); x++) {
      if (terrainAt(map, x, y) !== 'wall') continue;
      ctx.fillStyle = STONE;
      ctx.fillRect(x * c, y * c, c, c);
      ctx.strokeStyle = 'rgba(42, 36, 31, 0.5)';
      ctx.lineWidth = Math.max(0.5, c * 0.03);
      ctx.beginPath();
      // Courses
      if (horizontal) {
        ctx.moveTo(x * c, (y + 0.5) * c);
        ctx.lineTo((x + 1) * c, (y + 0.5) * c);
        const off = (x + y) % 2 ? 0.25 : 0.75;
        ctx.moveTo((x + off) * c, y * c);
        ctx.lineTo((x + off) * c, (y + 0.5) * c);
        ctx.moveTo((x + 1 - off) * c, (y + 0.5) * c);
        ctx.lineTo((x + 1 - off) * c, (y + 1) * c);
      } else {
        ctx.moveTo((x + 0.5) * c, y * c);
        ctx.lineTo((x + 0.5) * c, (y + 1) * c);
        const off = (x + y) % 2 ? 0.25 : 0.75;
        ctx.moveTo(x * c, (y + off) * c);
        ctx.lineTo((x + 0.5) * c, (y + off) * c);
        ctx.moveTo((x + 0.5) * c, (y + 1 - off) * c);
        ctx.lineTo((x + 1) * c, (y + 1 - off) * c);
      }
      ctx.stroke();
    }
}

/** A square tower: heavy stone with a walled walk around a central roof. */
function drawTower(ctx: Ctx, st: StructureObject, c: number) {
  const { x, y, w, h } = st.rect;
  ctx.fillStyle = STONE;
  ctx.fillRect(x * c, y * c, w * c, h * c);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = Math.max(1.2, c * 0.1);
  ctx.strokeRect(x * c, y * c, w * c, h * c);
  // Battlements: notches along the edge
  ctx.fillStyle = INK.ink;
  const n = w * 2;
  for (let k = 0; k < n; k += 2) {
    const s = c * 0.22;
    ctx.fillRect((x + (k + 0.5) / 2) * c - s / 2, y * c, s, s);
    ctx.fillRect((x + (k + 0.5) / 2) * c - s / 2, (y + h) * c - s, s, s);
    ctx.fillRect(x * c, (y + (k + 0.5) / 2) * c - s / 2, s, s);
    ctx.fillRect((x + w) * c - s, (y + (k + 0.5) / 2) * c - s / 2, s, s);
  }
  ctx.lineWidth = Math.max(0.8, c * 0.05);
  ctx.strokeRect((x + 0.6) * c, (y + 0.6) * c, (w - 1.2) * c, (h - 1.2) * c);
  ctx.fillStyle = ROOF;
  ctx.fillRect((x + 1) * c, (y + 1) * c, (w - 2) * c, (h - 2) * c);
  ctx.beginPath();
  ctx.moveTo((x + 1) * c, (y + 1) * c);
  ctx.lineTo((x + w - 1) * c, (y + h - 1) * c);
  ctx.moveTo((x + w - 1) * c, (y + 1) * c);
  ctx.lineTo((x + 1) * c, (y + h - 1) * c);
  ctx.strokeRect((x + 1) * c, (y + 1) * c, (w - 2) * c, (h - 2) * c);
  ctx.stroke();
}

function drawStructures(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region) {
  const near = (st: StructureObject) => st.rect.x < r.x1 + 1 && st.rect.x + st.rect.w > r.x0 - 1 && st.rect.y < r.y1 + 1 && st.rect.y + st.rect.h > r.y0 - 1;
  for (const st of p.structures) if (st.type === 'building' && near(st)) drawRoof(ctx, st.rect, c);
  for (const st of p.structures) if (st.type === 'wall' && near(st)) drawWallStones(ctx, map, st, c, r);
}

function drawTowers(ctx: Ctx, p: Pre, c: number, r: Region) {
  for (const st of p.structures)
    if (st.type === 'tower' && st.rect.x < r.x1 + 1 && st.rect.x + st.rect.w > r.x0 - 1 && st.rect.y < r.y1 + 1 && st.rect.y + st.rect.h > r.y0 - 1) drawTower(ctx, st, c);
}

function drawFeatures(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region) {
  // Ground-level texture first (it can spill a little into neighbouring squares).
  forCells(map, r, 1, (x, y, i) => {
    const t = map.terrain[i];
    if (t === 'water' || t === 'deepwater') drawWater(ctx, x, y, t === 'deepwater', c, rngAt(p.seed, SALT.water, x, y));
    else if (t === 'brush') drawBrush(ctx, x, y, c, rngAt(p.seed, SALT.brush, x, y));
    else if (t === 'ground' && p.style !== 'dungeon') drawGrass(ctx, x, y, c, rngAt(p.seed, SALT.grass, x, y));
    else if (t === 'road') drawRoadPebbles(ctx, x, y, c, rngAt(p.seed, SALT.road, x, y));
    if (isDifficult(map, x, y) && !p.furnitureCells.has(i) && (t === 'floor' || t === 'ground' || t === 'road'))
      drawRubble(ctx, x, y, c, rngAt(p.seed, SALT.rubble, x, y));
  });
  forCells(map, r, 0, (x, y, i) => {
    switch (map.terrain[i]) {
      case 'door':
        drawDoor(ctx, map, x, y, p.doors.get(i) ?? 'closed', c);
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
  });
  for (const f of p.furniture) if (f.rect.x < r.x1 + 1 && f.rect.x + f.rect.w > r.x0 - 1 && f.rect.y < r.y1 + 1 && f.rect.y + f.rect.h > r.y0 - 1) drawFurniture(ctx, f, c);
  for (const l of p.loot) if (l.at.x >= r.x0 - 1 && l.at.x <= r.x1 && l.at.y >= r.y0 - 1 && l.at.y <= r.y1) drawLoot(ctx, l, c);
}

function drawTrees(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region) {
  forCells(map, r, 1, (x, y, i) => {
    if (map.terrain[i] === 'tree') drawTree(ctx, x, y, c, rngAt(p.seed, SALT.tree, x, y));
  });
}

function drawRoomNumbers(ctx: Ctx, map: DungeonMap, p: Pre, c: number, r: Region) {
  ctx.font = `italic bold ${Math.round(c * 0.62)}px Georgia, 'Palatino Linotype', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  p.rooms.forEach((room, i) => {
    let cx = (room.rect.x + room.rect.w / 2) * c;
    let cy = (room.rect.y + room.rect.h / 2) * c;
    const sx = Math.floor(cx / c),
      sy = Math.floor(cy / c);
    if (sx < r.x0 - 2 || sx > r.x1 + 1 || sy < r.y0 - 2 || sy > r.y1 + 1) return;
    // Nudge off a stairs square so the number doesn't sit on top of it.
    if (terrainAt(map, sx, sy) === 'stairs') cy -= c * 0.9;
    if (room.rect.w % 2 === 1) cx = (Math.floor(cx / c) + 0.5) * c;
    const label = String(i + 1);
    ctx.lineWidth = c * 0.18;
    ctx.strokeStyle = INK.floor;
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = INK.ink;
    ctx.fillText(label, cx, cy);
  });
}

/**
 * Draw the squares in `r` (and only those: the output is clipped to them).
 * The context's origin must be the map's top-left corner, in pixels.
 */
export function drawInkRegion(ctx: Ctx, map: DungeonMap, opts: InkOptions, r: Region): void {
  const c = opts.cell;
  const p = pre(map);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x0 * c, r.y0 * c, (r.x1 - r.x0) * c, (r.y1 - r.y0) * c);
  ctx.clip();
  drawPaper(ctx, map, p, c, r);
  drawHatching(ctx, map, p, c, r);
  drawFloor(ctx, map, p, c, r, opts.grid);
  drawRoadEdges(ctx, p, c, r);
  drawStructures(ctx, map, p, c, r);
  drawFeatures(ctx, map, p, c, r);
  drawWalls(ctx, p, c, r);
  drawTowers(ctx, p, c, r);
  drawTrees(ctx, map, p, c, r);
  if (opts.roomNumbers) drawRoomNumbers(ctx, map, p, c, r);
  ctx.restore();
}

/** Draw the whole static map (everything that doesn't move during play). */
export function drawInkMap(ctx: Ctx, map: DungeonMap, opts: InkOptions): void {
  drawInkRegion(ctx, map, opts, { x0: 0, y0: 0, x1: map.width, y1: map.height });
}
