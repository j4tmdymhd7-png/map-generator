/**
 * Outdoor maps (huge and gargantuan): forests/wilderness and towns/cities.
 *
 * "Rooms" outdoors are the places that matter (clearings, squares, yards):
 * they get numbers, loot and encounters just like dungeon rooms. They're
 * ordered nearest-to-farthest from where the party arrives, so the last one
 * is the "lair".
 */
import { createEmptyMap, idx, ORTHOGONAL, rectCenter } from '../model/grid';
import type { DungeonMap, FurnitureObject, FurnitureType, Point, Rect, RoomObject, Terrain } from '../model/types';
import { createRng, type Rng } from '../rng';
import type { GenerateResult } from './generate';
import { validateDungeon } from './validate';

export const OUTDOOR_VERSION = 1;
export type OutdoorScale = 'huge' | 'gargantuan';
const DIM: Record<OutdoorScale, number> = { huge: 120, gargantuan: 200 };

// ---------------------------------------------------------------------------
// Helpers

/** Smooth value noise in [0, 1). */
function makeNoise(rng: Rng, W: number, H: number, cell: number): (x: number, y: number) => number {
  const gw = Math.ceil(W / cell) + 2,
    gh = Math.ceil(H / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rng.next());
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell,
      fy = y / cell;
    const ix = Math.floor(fx),
      iy = Math.floor(fy);
    const tx = s(fx - ix),
      ty = s(fy - iy);
    const v = (a: number, b: number) => g[b * gw + a];
    const top = v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx;
    const bot = v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
}

/** Dijkstra on 4-neighbors from `from` to any cell in `targets`; returns the path (cells). */
function route(W: number, H: number, cost: (i: number) => number, from: number, targets: Set<number>, turn = 0.4): number[] {
  const n = W * H;
  const dist = new Float64Array(n * 4).fill(Infinity);
  const prev = new Int32Array(n * 4).fill(-1);
  const heap: [number, number][] = [];
  const push = (c: number, s: number) => {
    heap.push([c, s]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 4; d++) {
    dist[from * 4 + d] = 0;
    push(0, from * 4 + d);
  }
  let end = -1;
  while (heap.length) {
    const [c, s] = pop();
    if (c > dist[s]) continue;
    const cell = s >> 2,
      dir = s & 3;
    if (targets.has(cell)) {
      end = s;
      break;
    }
    const x = cell % W,
      y = (cell - x) / W;
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + ORTHOGONAL[nd].x,
        ny = y + ORTHOGONAL[nd].y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      const step = cost(ni);
      if (!Number.isFinite(step)) continue;
      const nc = c + step + (nd === dir ? 0 : turn);
      const ns = ni * 4 + nd;
      if (nc < dist[ns]) {
        dist[ns] = nc;
        prev[ns] = s;
        push(nc, ns);
      }
    }
  }
  if (end < 0) return [];
  const path: number[] = [];
  for (let s = end; s >= 0; s = prev[s]) path.push(s >> 2);
  return path.reverse();
}

/** Squares reachable on foot from `start`. */
function reachable(map: DungeonMap, start: Point): Uint8Array {
  const seen = new Uint8Array(map.width * map.height);
  const walk = (t: Terrain) => t !== 'wall' && t !== 'tree' && t !== 'deepwater' && t !== 'void' && t !== 'obstacle' && t !== 'furniture';
  const q = [idx(map, start.x, start.y)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % map.width,
      y = (i - x) / map.width;
    for (const d of ORTHOGONAL) {
      const nx = x + d.x,
        ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = idx(map, nx, ny);
      if (!seen[ni] && walk(map.terrain[ni])) {
        seen[ni] = 1;
        q.push(ni);
      }
    }
  }
  return seen;
}

function orderRooms(rooms: RoomObject[], spawn: Point): RoomObject[] {
  const d = (r: RoomObject) => {
    const c = rectCenter(r.rect);
    return Math.hypot(c.x - spawn.x, c.y - spawn.y);
  };
  return [...rooms].sort((a, b) => d(a) - d(b));
}

class Props {
  objects: FurnitureObject[] = [];
  private n = 0;
  add(type: FurnitureType, rect: Rect, label?: string) {
    this.objects.push({ id: `prop-${++this.n}`, kind: 'furniture', type, rect, label, visibility: 'public' });
  }
}

/** A meandering band of water across the map. */
function carveRiver(map: DungeonMap, rng: Rng, vertical: boolean, at: number, width: number, deepWidth: number) {
  const W = map.width,
    H = map.height;
  const len = vertical ? H : W;
  const amp = (vertical ? W : H) * 0.08;
  const p1 = rng.next() * 6,
    p2 = rng.next() * 6;
  for (let k = 0; k < len; k++) {
    const c = at + amp * Math.sin(k / 23 + p1) + amp * 0.4 * Math.sin(k / 9 + p2);
    for (let o = -Math.ceil(width / 2); o <= Math.ceil(width / 2); o++) {
      const dist = Math.abs(o - (c - Math.round(c)));
      if (dist > width / 2) continue;
      const x = vertical ? Math.round(c) + o : k;
      const y = vertical ? k : Math.round(c) + o;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      map.terrain[idx(map, x, y)] = dist <= deepWidth / 2 ? 'deepwater' : 'water';
    }
  }
}

// ---------------------------------------------------------------------------
// Forest / wilderness

export function generateForest(seed: string, scale: OutdoorScale): GenerateResult {
  const W = DIM[scale],
    H = W;
  const rng = createRng(`forest:${OUTDOOR_VERSION}:${scale}:${seed}`);
  const kind = scale === 'huge' ? 'forest' : 'wilderness';
  const map = createEmptyMap({ id: `map-${scale}-${kind}-${seed}`, title: `${scale === 'huge' ? 'Forest' : 'Wilderness'} ${seed}`, width: W, height: H, fill: 'ground' });
  map.style = 'outdoor';
  map.generation = { seed, generatorVersion: OUTDOOR_VERSION, params: { kind, scale } };

  const big = makeNoise(rng, W, H, 16),
    small = makeNoise(rng, W, H, 5);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = 0.65 * big(x, y) + 0.35 * small(x, y);
      const i = idx(map, x, y);
      if (d > 0.58) map.terrain[i] = rng.chance(0.82) ? 'tree' : 'brush';
      else if (d > 0.5) map.terrain[i] = rng.chance(0.55) ? 'brush' : rng.chance(0.25) ? 'tree' : 'ground';
      else if (d > 0.38 && rng.chance(0.04)) map.terrain[i] = 'tree';
    }

  // Water
  if (scale === 'gargantuan') {
    const lc = { x: rng.int(W * 0.55, W * 0.8), y: rng.int(H * 0.2, H * 0.8) };
    const R = rng.int(14, 20);
    const ph = rng.next() * 6;
    for (let y = lc.y - R - 3; y <= lc.y + R + 3; y++)
      for (let x = lc.x - R - 3; x <= lc.x + R + 3; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const a = Math.atan2(y - lc.y, x - lc.x);
        const r = R * (1 + 0.18 * Math.sin(3 * a + ph) + 0.08 * Math.sin(7 * a));
        const d = Math.hypot(x - lc.x, y - lc.y);
        if (d <= r * 0.78) map.terrain[idx(map, x, y)] = 'deepwater';
        else if (d <= r) map.terrain[idx(map, x, y)] = 'water';
      }
    carveRiver(map, rng, true, rng.int(W * 0.3, W * 0.45), 5, 3);
  } else if (rng.chance(0.7)) {
    carveRiver(map, rng, true, rng.int(W * 0.35, W * 0.65), 3, 0);
  }

  // Clearings
  const want = scale === 'huge' ? rng.int(9, 12) : rng.int(20, 26);
  const maxR = scale === 'huge' ? 6 : 8;
  const clearings: { c: Point; r: number }[] = [];
  for (let attempt = 0; attempt < want * 60 && clearings.length < want; attempt++) {
    const r = rng.int(3, maxR);
    const c = { x: rng.int(r + 4, W - r - 5), y: rng.int(r + 4, H - r - 5) };
    if (map.terrain[idx(map, c.x, c.y)] === 'deepwater') continue;
    if (clearings.some((o) => Math.hypot(o.c.x - c.x, o.c.y - c.y) < o.r + r + 6)) continue;
    clearings.push({ c, r });
  }
  for (const { c, r } of clearings)
    for (let y = c.y - r; y <= c.y + r; y++)
      for (let x = c.x - r; x <= c.x + r; x++) {
        const i = idx(map, x, y);
        if (Math.hypot(x - c.x, y - c.y) <= r + 0.3 && map.terrain[i] !== 'deepwater' && map.terrain[i] !== 'water') map.terrain[i] = 'ground';
      }

  // Trail: from the west edge through every clearing (minimum spanning tree plus a few loops).
  const spawn = { x: 1, y: rng.int(Math.floor(H * 0.35), Math.floor(H * 0.65)) };
  map.terrain[idx(map, 0, spawn.y)] = 'road';
  const nodes = [spawn, ...clearings.map((c) => c.c)];
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  const dist = (a: number, b: number) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
  while (inTree.size < nodes.length) {
    let best: [number, number] | null = null;
    for (const a of inTree) for (let b = 0; b < nodes.length; b++) if (!inTree.has(b) && (!best || dist(a, b) < dist(best[0], best[1]))) best = [a, b];
    edges.push(best!);
    inTree.add(best![1]);
  }
  for (let a = 1; a < nodes.length; a++)
    for (let b = a + 1; b < nodes.length; b++) if (dist(a, b) < 30 && rng.chance(0.08)) edges.push([a, b]);
  const trailCost = (i: number) => {
    const t = map.terrain[i];
    const base = t === 'road' ? 0.5 : t === 'ground' ? 1 : t === 'brush' ? 2 : t === 'water' ? 5 : t === 'tree' ? 7 : t === 'deepwater' ? 30 : 1;
    const x = i % W;
    return base + 0.8 * small(x, (i - x) / W);
  };
  for (const [a, b] of edges) {
    const path = route(W, H, trailCost, idx(map, nodes[a].x, nodes[a].y), new Set([idx(map, nodes[b].x, nodes[b].y)]));
    for (const i of path) {
      const t = map.terrain[i];
      if (t === 'tree' || t === 'brush' || t === 'ground' || t === 'deepwater') map.terrain[i] = 'road'; // deep water: a bridge
    }
  }

  // Dress some clearings
  const props = new Props();
  const rooms: RoomObject[] = clearings.map(({ c, r }, k) => ({
    id: `clearing-${k + 1}`,
    kind: 'room',
    rect: { x: c.x - r, y: c.y - r, w: 2 * r + 1, h: 2 * r + 1 },
    shape: 'round',
    label: `Clearing ${k + 1}`,
    visibility: 'public',
  }));
  const ordered = orderRooms(rooms, spawn);
  ordered.forEach((room, k) => {
    if (k === 0) return; // keep the first clearing calm
    const c = rectCenter(room.rect),
      r = (room.rect.w - 1) / 2;
    const free = (x: number, y: number) => map.terrain[idx(map, x, y)] === 'ground' && !(x === c.x && y === c.y);
    const roll = rng.next();
    if (roll < 0.25 && r >= 4) {
      // Standing stones in a ring
      for (let a = 0; a < 8; a++) {
        const x = Math.round(c.x + Math.cos((a / 8) * Math.PI * 2) * (r - 1)),
          y = Math.round(c.y + Math.sin((a / 8) * Math.PI * 2) * (r - 1));
        if (free(x, y)) map.terrain[idx(map, x, y)] = 'obstacle';
      }
      room.label = `Standing stones`;
    } else if (roll < 0.45) {
      if (free(c.x + 1, c.y)) {
        map.terrain[idx(map, c.x + 1, c.y)] = 'furniture';
        props.add('hearth', { x: c.x + 1, y: c.y, w: 1, h: 1 }, 'Campfire');
      }
      room.label = 'Old campsite';
    } else if (roll < 0.6 && r >= 4) {
      // Ruined walls
      const x0 = c.x - 2,
        y0 = c.y - 2;
      for (let k2 = 0; k2 < 5; k2++) {
        if (free(x0 + k2, y0) && rng.chance(0.8)) map.terrain[idx(map, x0 + k2, y0)] = 'wall';
        if (free(x0, y0 + k2) && rng.chance(0.8)) map.terrain[idx(map, x0, y0 + k2)] = 'wall';
      }
      room.label = 'Ruins';
    } else if (roll < 0.72) {
      const pc = { x: c.x + rng.int(-1, 1) * 2, y: c.y + 2 };
      for (let y = pc.y - 1; y <= pc.y + 1; y++) for (let x = pc.x - 1; x <= pc.x + 1; x++) if (free(x, y)) map.terrain[idx(map, x, y)] = 'water';
      room.label = 'Pond';
    }
  });
  const counts: Record<string, number> = {};
  for (const r of ordered) if (r.label) counts[r.label] = (counts[r.label] ?? 0) + 1;
  const seen: Record<string, number> = {};
  for (const r of ordered) if (r.label && !r.label.startsWith('Clearing') && counts[r.label] > 1) r.label = `${r.label} ${(seen[r.label] = (seen[r.label] ?? 0) + 1)}`;
  ordered.forEach((r, k) => r.label?.startsWith('Clearing') && (r.label = `Clearing ${k + 1}`));

  map.spawn = spawn;
  map.objects = [...ordered, ...props.objects];
  return { map, issues: validateDungeon(map) };
}

// ---------------------------------------------------------------------------
// Town / city

const PLAZA_NAMES = ['Market square', 'Temple square', 'Guild square', 'Fountain court', 'Old square', 'Moot hall green'];

export function generateTown(seed: string, scale: OutdoorScale): GenerateResult {
  const W = DIM[scale],
    H = W;
  const rng = createRng(`town:${OUTDOOR_VERSION}:${scale}:${seed}`);
  const kind = scale === 'huge' ? 'town' : 'city';
  const map = createEmptyMap({ id: `map-${scale}-${kind}-${seed}`, title: `${scale === 'huge' ? 'Town' : 'City'} ${seed}`, width: W, height: H, fill: 'ground' });
  map.style = 'outdoor';
  map.generation = { seed, generatorVersion: OUTDOOR_VERSION, params: { kind, scale } };
  const set = (x: number, y: number, t: Terrain) => {
    if (x >= 0 && y >= 0 && x < W && y < H) map.terrain[idx(map, x, y)] = t;
  };

  const walled = scale === 'gargantuan';
  const inset = walled ? 12 : 5;
  const town: Rect = { x: inset, y: inset, w: W - inset * 2, h: H - inset * 2 };

  // Outskirts: scattered trees and brush
  const n = makeNoise(rng, W, H, 9);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inTown = x >= town.x && y >= town.y && x < town.x + town.w && y < town.y + town.h;
      if (inTown) continue;
      const d = n(x, y);
      if (d > 0.62) set(x, y, rng.chance(0.6) ? 'tree' : 'brush');
      else if (d > 0.52 && rng.chance(0.3)) set(x, y, 'brush');
    }

  // City wall (gargantuan): two squares thick; gates appear where avenues cut through.
  if (walled) {
    for (let y = town.y - 2; y < town.y + town.h + 2; y++)
      for (let x = town.x - 2; x < town.x + town.w + 2; x++) {
        const ring = x < town.x || y < town.y || x >= town.x + town.w || y >= town.y + town.h;
        if (ring) set(x, y, 'wall');
      }
  }

  // River (always in a city, sometimes in a town)
  const riverY = rng.chance(0.5) ? Math.floor(H * 0.3) : Math.floor(H * 0.7);
  if (walled || rng.chance(0.4)) carveRiver(map, rng, false, riverY, walled ? 6 : 4, walled ? 4 : 2);

  // Avenues (3 wide, edge to edge) and streets (2 wide, inside the town)
  const ax = Math.floor(W / 2) + rng.int(-Math.floor(W / 10), Math.floor(W / 10));
  const ay = Math.floor(H / 2) + rng.int(-Math.floor(H / 10), Math.floor(H / 10));
  for (let k = 0; k < W; k++)
    for (let o = -1; o <= 1; o++) {
      set(ax + o, k, 'road');
      set(k, ay + o, 'road');
    }
  const streets = (start: number, end: number, avenue: number) => {
    const out: number[] = [];
    for (let p = start + rng.int(6, 10); p < end - 6; p += rng.int(11, 16)) if (Math.abs(p - avenue) > 5) out.push(p);
    return out;
  };
  for (const sx of streets(town.x, town.x + town.w, ax)) {
    const from = town.y + (rng.chance(0.3) ? rng.int(0, Math.floor(town.h / 2)) : 0);
    const to = town.y + town.h - 1 - (rng.chance(0.3) ? rng.int(0, Math.floor(town.h / 2)) : 0);
    for (let y = from; y <= to; y++) {
      set(sx, y, 'road');
      set(sx + 1, y, 'road');
    }
  }
  for (const sy of streets(town.y, town.y + town.h, ay)) {
    const from = town.x + (rng.chance(0.3) ? rng.int(0, Math.floor(town.w / 2)) : 0);
    const to = town.x + town.w - 1 - (rng.chance(0.3) ? rng.int(0, Math.floor(town.w / 2)) : 0);
    for (let x = from; x <= to; x++) {
      set(x, sy, 'road');
      set(x, sy + 1, 'road');
    }
  }

  // Blocks: connected patches of ground inside the town.
  const blockOf = new Int32Array(W * H).fill(-1);
  const blocks: number[][] = [];
  for (let y = town.y; y < town.y + town.h; y++)
    for (let x = town.x; x < town.x + town.w; x++) {
      const i = idx(map, x, y);
      if (blockOf[i] >= 0 || map.terrain[i] !== 'ground') continue;
      const cells = [i];
      blockOf[i] = blocks.length;
      for (let h = 0; h < cells.length; h++) {
        const c = cells[h];
        const cx = c % W,
          cy = (c - cx) / W;
        for (const d of ORTHOGONAL) {
          const nx = cx + d.x,
            ny = cy + d.y;
          if (nx < town.x || ny < town.y || nx >= town.x + town.w || ny >= town.y + town.h) continue;
          const ni = idx(map, nx, ny);
          if (blockOf[ni] < 0 && map.terrain[ni] === 'ground') {
            blockOf[ni] = blocks.length;
            cells.push(ni);
          }
        }
      }
      blocks.push(cells);
    }
  const bounds = (cells: number[]): Rect => {
    let x0 = W,
      y0 = H,
      x1 = 0,
      y1 = 0;
    for (const c of cells) {
      const x = c % W,
        y = (c - x) / W;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  const props = new Props();
  const rooms: RoomObject[] = [];
  // Plazas: the blocks nearest the crossroads (and a few more in a city).
  const center = { x: ax, y: ay };
  const big = blocks.map((cells, k) => ({ k, cells, r: bounds(cells) })).filter((b) => b.cells.length >= 30 && b.r.w >= 6 && b.r.h >= 6);
  big.sort((a, b) => Math.hypot(rectCenter(a.r).x - center.x, rectCenter(a.r).y - center.y) - Math.hypot(rectCenter(b.r).x - center.x, rectCenter(b.r).y - center.y));
  const plazaCount = walled ? 5 : 2;
  const plazas = new Set<number>();
  for (let p = 0; p < big.length && plazas.size < plazaCount; p += plazas.size === 0 ? 1 : rng.int(1, 3)) plazas.add(big[p].k);
  let plazaN = 0;
  for (const k of plazas) {
    const cells = blocks[k];
    const r = bounds(cells);
    for (const c of cells) map.terrain[c] = 'road';
    const c = rectCenter(r);
    const name = PLAZA_NAMES[plazaN++ % PLAZA_NAMES.length];
    if (map.terrain[idx(map, c.x + 1, c.y + 1)] === 'road') {
      set(c.x + 1, c.y + 1, 'furniture');
      props.add('well', { x: c.x + 1, y: c.y + 1, w: 1, h: 1 }, 'Well');
    }
    if (name === 'Market square')
      for (let y = r.y + 2; y < r.y + r.h - 2; y += 3)
        for (let x = r.x + 2; x + 1 < r.x + r.w - 2; x += 4) {
          if (Math.abs(x - c.x) <= 2 && Math.abs(y - c.y) <= 2) continue;
          if (map.terrain[idx(map, x, y)] === 'road' && map.terrain[idx(map, x + 1, y)] === 'road') {
            set(x, y, 'furniture');
            set(x + 1, y, 'furniture');
            props.add('stall', { x, y, w: 2, h: 1 }, 'Market stall');
          }
        }
    rooms.push({ id: `plaza-${plazaN}`, kind: 'room', rect: r, label: name, visibility: 'public' });
  }

  // Everything else: split into lots; most become buildings, some yards.
  let yardN = 0;
  blocks.forEach((cells, k) => {
    if (plazas.has(k)) return;
    const inBlock = new Set(cells);
    const lots: Rect[] = [];
    const split = (r: Rect) => {
      const maxSide = rng.int(6, 9);
      if (r.w <= maxSide && r.h <= maxSide) {
        lots.push(r);
        return;
      }
      if (r.w >= r.h) {
        const at = rng.int(3, r.w - 3);
        split({ x: r.x, y: r.y, w: at, h: r.h });
        split({ x: r.x + at, y: r.y, w: r.w - at, h: r.h });
      } else {
        const at = rng.int(3, r.h - 3);
        split({ x: r.x, y: r.y, w: r.w, h: at });
        split({ x: r.x, y: r.y + at, w: r.w, h: r.h - at });
      }
    };
    split(bounds(cells));
    for (const lot of lots) {
      const lotCells: Point[] = [];
      for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) if (inBlock.has(idx(map, x, y))) lotCells.push({ x, y });
      if (lotCells.length === 0) continue;
      if (lot.w >= 4 && lot.h >= 4 && rng.chance(0.12) && yardN < (walled ? 24 : 10)) {
        yardN++;
        for (const p of lotCells) if (rng.chance(0.12)) set(p.x, p.y, rng.chance(0.5) ? 'tree' : 'brush');
        const c = rectCenter(lot);
        set(c.x, c.y, 'ground');
        rooms.push({ id: `yard-${yardN}`, kind: 'room', rect: lot, label: rng.chance(0.5) ? `Yard ${yardN}` : `Garden ${yardN}`, visibility: 'public' });
        continue;
      }
      // Building: the lot, minus an alley on its far sides now and then.
      const trimR = rng.chance(0.45),
        trimB = rng.chance(0.45);
      for (const p of lotCells) {
        if ((trimR && p.x === lot.x + lot.w - 1) || (trimB && p.y === lot.y + lot.h - 1)) continue;
        set(p.x, p.y, 'wall');
      }
    }
  });

  // Make sure every yard can be reached: cut an alley to the nearest street if not.
  const spawn = { x: 0, y: ay };
  let reach = reachable(map, spawn);
  for (const room of rooms) {
    const c = rectCenter(room.rect);
    if (reach[idx(map, c.x, c.y)]) continue;
    const targets = new Set<number>();
    reach.forEach((v, i) => v && targets.add(i));
    const path = route(W, H, (i) => (map.terrain[i] === 'wall' ? 4 : map.terrain[i] === 'deepwater' ? Infinity : 1), idx(map, c.x, c.y), targets, 0.2);
    for (const i of path) if (map.terrain[i] === 'wall' || map.terrain[i] === 'tree') map.terrain[i] = 'ground';
    reach = reachable(map, spawn);
  }

  map.spawn = spawn;
  map.objects = [...orderRooms(rooms, spawn), ...props.objects];
  return { map, issues: validateDungeon(map) };
}
