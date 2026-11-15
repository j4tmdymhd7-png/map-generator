/**
 * Outdoor maps (huge and gargantuan): forests/wilderness and towns/cities.
 *
 * "Rooms" outdoors are the places that matter (clearings, squares, yards):
 * they get numbers, loot and encounters just like dungeon rooms. They're
 * ordered nearest-to-farthest from where the party arrives, so the last one
 * is the "lair".
 */
import { createEmptyMap, idx, ORTHOGONAL, rectCenter } from '../model/grid';
import type { DoorObject, DungeonMap, FurnitureObject, FurnitureType, Point, Rect, RoomObject, StructureObject, Terrain } from '../model/types';
import { createRng, type Rng } from '../rng';
import type { GenerateResult } from './generate';
import { validateDungeon } from './validate';

export const OUTDOOR_VERSION = 2;
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
//
// Layout follows how real towns are built:
// - a grid of streets (one avenue each way, 3 wide; streets 2 wide) whose
//   spacing varies; now and then a street segment is left out, so two blocks
//   merge into one longer block;
// - every block is lined with rectangular buildings fronting its streets
//   (row houses and shops of varied widths and depths), with an open courtyard
//   behind them reached by narrow alleys; some alleys end at a back house;
// - squares near the crossroads with wells and market stalls;
// - cities add a wall: a ring road inside it so houses never touch it, square
//   towers at the corners and along each side, and gatehouses (gates are doors
//   that can be closed or locked) where the avenues leave the city.

const PLAZA_NAMES = ['Market square', 'Temple square', 'Guild square', 'Fountain court', 'Old square', 'Moot hall green'];
const GATE_NAMES = { n: 'North gate', s: 'South gate', w: 'West gate', e: 'East gate' } as const;

interface Line {
  pos: number;
  w: number;
}

export function generateTown(seed: string, scale: OutdoorScale): GenerateResult {
  const W = DIM[scale],
    H = W;
  const rng = createRng(`town:${OUTDOOR_VERSION}:${scale}:${seed}`);
  const kind = scale === 'huge' ? 'town' : 'city';
  const map = createEmptyMap({ id: `map-${scale}-${kind}-${seed}`, title: `${scale === 'huge' ? 'Town' : 'City'} ${seed}`, width: W, height: H, fill: 'ground' });
  map.style = 'outdoor';
  map.generation = { seed, generatorVersion: OUTDOOR_VERSION, params: { kind, scale } };
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const get = (x: number, y: number) => (inMap(x, y) ? map.terrain[idx(map, x, y)] : 'void');
  const set = (x: number, y: number, t: Terrain) => {
    if (inMap(x, y)) map.terrain[idx(map, x, y)] = t;
  };

  const walled = scale === 'gargantuan';
  const margin = walled ? 16 : 6;
  const T: Rect = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin };
  const inT = (x: number, y: number) => x >= T.x && y >= T.y && x < T.x + T.w && y < T.y + T.h;

  // Countryside: trees and brush outside the town.
  const n = makeNoise(rng, W, H, 9);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x >= T.x - 6 && y >= T.y - 6 && x < T.x + T.w + 6 && y < T.y + T.h + 6) continue;
      const d = n(x, y);
      if (d > 0.62) set(x, y, rng.chance(0.6) ? 'tree' : 'brush');
      else if (d > 0.52 && rng.chance(0.3)) set(x, y, 'brush');
    }

  // River first, so streets crossing it become bridges.
  const hasRiver = walled || rng.chance(0.4);
  if (hasRiver) carveRiver(map, rng, false, rng.chance(0.5) ? Math.floor(H * 0.3) : Math.floor(H * 0.7), walled ? 6 : 4, walled ? 4 : 2);
  const isWater = (x: number, y: number) => get(x, y) === 'water' || get(x, y) === 'deepwater';

  // Street lines: the first and last run along the town's edge (inside a city wall, that's the ring road).
  const lines = (start: number, len: number): Line[] => {
    const out: Line[] = [{ pos: start, w: 2 }];
    for (let p = start + rng.int(13, 18); p < start + len - 2 - 9; p += rng.int(13, 18)) out.push({ pos: p, w: 2 });
    out.push({ pos: start + len - 2, w: 2 });
    return out;
  };
  const xs = lines(T.x, T.w),
    ys = lines(T.y, T.h);
  const avenue = (ls: Line[], mid: number) => {
    let best = 1;
    for (let i = 1; i < ls.length - 1; i++) if (Math.abs(ls[i].pos - mid) < Math.abs(ls[best].pos - mid)) best = i;
    ls[best].w = 3;
    return best;
  };
  const ai = avenue(xs, W / 2),
    aj = avenue(ys, H / 2);
  const nbx = xs.length - 1,
    nby = ys.length - 1;
  const col = (i: number) => ({ a: xs[i].pos + xs[i].w, b: xs[i + 1].pos - 1 }); // inclusive x range of block column i
  const row = (j: number) => ({ a: ys[j].pos + ys[j].w, b: ys[j + 1].pos - 1 });

  // Leave out some street segments so pairs of blocks merge.
  const vOmit = new Set<string>(),
    hOmit = new Set<string>();
  const merged = new Int32Array(nbx * nby).fill(-1);
  const bid = (i: number, j: number) => j * nbx + i;
  for (let i = 1; i < nbx; i++) {
    if (i === ai) continue;
    for (let j = 0; j < nby; j++)
      if (merged[bid(i - 1, j)] < 0 && merged[bid(i, j)] < 0 && rng.chance(0.14)) {
        vOmit.add(`${i}:${j}`);
        merged[bid(i - 1, j)] = bid(i, j);
        merged[bid(i, j)] = bid(i - 1, j);
      }
  }
  for (let j = 1; j < nby; j++) {
    if (j === aj) continue;
    for (let i = 0; i < nbx; i++)
      if (merged[bid(i, j - 1)] < 0 && merged[bid(i, j)] < 0 && rng.chance(0.14)) {
        hOmit.add(`${j}:${i}`);
        merged[bid(i, j - 1)] = bid(i, j);
        merged[bid(i, j)] = bid(i, j - 1);
      }
  }
  // Carve streets
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ys.length; j++) {
      for (let x = xs[i].pos; x < xs[i].pos + xs[i].w; x++) for (let y = ys[j].pos; y < ys[j].pos + ys[j].w; y++) set(x, y, 'road'); // crossing
      if (j < nby && !vOmit.has(`${i}:${j}`)) {
        const r = row(j);
        for (let x = xs[i].pos; x < xs[i].pos + xs[i].w; x++) for (let y = r.a; y <= r.b; y++) set(x, y, 'road');
      }
      if (i < nbx && !hOmit.has(`${j}:${i}`)) {
        const c = col(i);
        for (let y = ys[j].pos; y < ys[j].pos + ys[j].w; y++) for (let x = c.a; x <= c.b; x++) set(x, y, 'road');
      }
    }
  // Avenues run on out of town to the map edges.
  for (let k = 0; k < W; k++)
    for (let o = 0; o < 3; o++) {
      if (!inT(xs[ai].pos + o, k)) set(xs[ai].pos + o, k, 'road');
      if (!inT(k, ys[aj].pos + o)) set(k, ys[aj].pos + o, 'road');
    }

  const structures: StructureObject[] = [];
  let sn = 0;
  const addStructure = (type: StructureObject['type'], rect: Rect, label?: string) =>
    structures.push({ id: `struct-${++sn}`, kind: 'structure', type, rect, label, visibility: 'public' });

  // City wall, towers and gatehouses
  const doors: DoorObject[] = [];
  if (walled) {
    const wx0 = T.x - 2,
      wy0 = T.y - 2,
      wx1 = T.x + T.w + 1,
      wy1 = T.y + T.h + 1; // outer bounds of the 2-thick ring
    const wallCell = (x: number, y: number) => {
      if (isWater(x, y)) return; // the river passes under the wall
      if (get(x, y) === 'road') return; // gates are cut later
      set(x, y, 'wall');
    };
    for (let x = wx0; x <= wx1; x++)
      for (const y of [wy0, wy0 + 1, wy1 - 1, wy1]) {
        if (get(x, y) === 'road') continue;
        wallCell(x, y);
      }
    for (let y = wy0; y <= wy1; y++)
      for (const x of [wx0, wx0 + 1, wx1 - 1, wx1]) {
        if (get(x, y) === 'road') continue;
        wallCell(x, y);
      }
    addStructure('wall', { x: wx0, y: wy0, w: wx1 - wx0 + 1, h: 2 });
    addStructure('wall', { x: wx0, y: wy1 - 1, w: wx1 - wx0 + 1, h: 2 });
    addStructure('wall', { x: wx0, y: wy0, w: 2, h: wy1 - wy0 + 1 });
    addStructure('wall', { x: wx1 - 1, y: wy0, w: 2, h: wy1 - wy0 + 1 });

    const tower = (x: number, y: number, label?: string) => {
      const r = { x, y, w: 4, h: 4 };
      for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) if (!isWater(xx, yy) && !inT(xx, yy)) set(xx, yy, 'wall');
      addStructure('tower', r, label);
    };
    // Corners (sticking out of the wall)
    tower(wx0 - 2, wy0 - 2);
    tower(wx1 - 1, wy0 - 2);
    tower(wx0 - 2, wy1 - 1);
    tower(wx1 - 1, wy1 - 1);
    // Gates: where each avenue crosses the wall. Outer course is the gate (doors), inner course a passage.
    const gx = xs[ai].pos,
      gy = ys[aj].pos;
    const gate = (cells: Point[], label: string) => {
      cells.forEach((p, k) => {
        set(p.x, p.y, 'door');
        doors.push({ id: `gate-${label}-${k}`, kind: 'door', at: p, state: 'open', label, visibility: 'public' });
      });
    };
    gate([0, 1, 2].map((o) => ({ x: gx + o, y: wy0 })), GATE_NAMES.n);
    gate([0, 1, 2].map((o) => ({ x: gx + o, y: wy1 })), GATE_NAMES.s);
    gate([0, 1, 2].map((o) => ({ x: wx0, y: gy + o })), GATE_NAMES.w);
    gate([0, 1, 2].map((o) => ({ x: wx1, y: gy + o })), GATE_NAMES.e);
    // Gatehouse towers flank each gate.
    tower(gx - 4, wy0 - 2, GATE_NAMES.n);
    tower(gx + 3, wy0 - 2, GATE_NAMES.n);
    tower(gx - 4, wy1 - 1, GATE_NAMES.s);
    tower(gx + 3, wy1 - 1, GATE_NAMES.s);
    tower(wx0 - 2, gy - 4, GATE_NAMES.w);
    tower(wx0 - 2, gy + 3, GATE_NAMES.w);
    tower(wx1 - 1, gy - 4, GATE_NAMES.e);
    tower(wx1 - 1, gy + 3, GATE_NAMES.e);
    // Towers along each side, clear of gates and corners
    for (let p = wx0 + 14; p < wx1 - 14; p += rng.int(14, 18)) {
      if (Math.abs(p - gx) < 10) continue;
      tower(p - 1, wy0 - 2);
      tower(p - 1, wy1 - 1);
    }
    for (let p = wy0 + 14; p < wy1 - 14; p += rng.int(14, 18)) {
      if (Math.abs(p - gy) < 10) continue;
      tower(wx0 - 2, p - 1);
      tower(wx1 - 1, p - 1);
    }
  }

  // Blocks: each block, or merged pair, as a rectangle.
  const blocks: Rect[] = [];
  const done = new Uint8Array(nbx * nby);
  for (let j = 0; j < nby; j++)
    for (let i = 0; i < nbx; i++) {
      if (done[bid(i, j)]) continue;
      done[bid(i, j)] = 1;
      let r: Rect = { x: col(i).a, y: row(j).a, w: col(i).b - col(i).a + 1, h: row(j).b - row(j).a + 1 };
      const m = merged[bid(i, j)];
      if (m >= 0) {
        done[m] = 1;
        const mi = m % nbx,
          mj = (m - mi) / nbx;
        const o: Rect = { x: col(mi).a, y: row(mj).a, w: col(mi).b - col(mi).a + 1, h: row(mj).b - row(mj).a + 1 };
        const x0 = Math.min(r.x, o.x),
          y0 = Math.min(r.y, o.y);
        r = { x: x0, y: y0, w: Math.max(r.x + r.w, o.x + o.w) - x0, h: Math.max(r.y + r.h, o.y + o.h) - y0 };
      }
      if (r.w >= 3 && r.h >= 3) blocks.push(r);
    }

  const props = new Props();
  const rooms: RoomObject[] = [];

  // Squares: the blocks nearest the crossroads.
  const cross = { x: xs[ai].pos + 1, y: ys[aj].pos + 1 };
  const byCentre = [...blocks].sort((a, b) => {
    const ca = rectCenter(a),
      cb = rectCenter(b);
    return Math.hypot(ca.x - cross.x, ca.y - cross.y) - Math.hypot(cb.x - cross.x, cb.y - cross.y);
  });
  const plazaCount = walled ? 4 : 2;
  const plazas = new Set<Rect>();
  const dry = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isWater(x, y)) return false;
    return true;
  };
  for (let k = 0; k < byCentre.length && plazas.size < plazaCount; k += plazas.size === 0 ? 1 : rng.int(2, 4))
    if (byCentre[k].w >= 7 && byCentre[k].h >= 7 && dry(byCentre[k])) plazas.add(byCentre[k]);
  let plazaN = 0;
  for (const r of plazas) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (get(x, y) === 'ground') set(x, y, 'road');
    const c = rectCenter(r);
    const name = PLAZA_NAMES[plazaN++ % PLAZA_NAMES.length];
    if (get(c.x + 1, c.y + 1) === 'road') {
      set(c.x + 1, c.y + 1, 'furniture');
      props.add('well', { x: c.x + 1, y: c.y + 1, w: 1, h: 1 }, 'Well');
    }
    if (name === 'Market square')
      for (let y = r.y + 2; y < r.y + r.h - 2; y += 3)
        for (let x = r.x + 2; x + 1 < r.x + r.w - 2; x += 4) {
          if (Math.abs(x - c.x) <= 2 && Math.abs(y - c.y) <= 2) continue;
          if (get(x, y) === 'road' && get(x + 1, y) === 'road') {
            set(x, y, 'furniture');
            set(x + 1, y, 'furniture');
            props.add('stall', { x, y, w: 2, h: 1 }, 'Market stall');
          }
        }
    rooms.push({ id: `plaza-${plazaN}`, kind: 'room', rect: r, label: name, visibility: 'public' });
  }

  // Buildings
  const building = (r: Rect) => {
    if (r.w < 2 || r.h < 2) return;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (get(x, y) !== 'ground') return; // never over water or roads
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, 'wall');
    addStructure('building', r);
  };
  /** Cut a strip into lots of 3-7 squares along its length, with an occasional 1-square alley between. */
  const lots = (from: number, to: number): { a: number; b: number }[] => {
    const out: { a: number; b: number }[] = [];
    let p = from;
    while (p <= to) {
      const len = Math.min(rng.int(3, 7), to - p + 1);
      if (to - (p + len) + 1 < 3) {
        out.push({ a: p, b: to });
        break;
      }
      out.push({ a: p, b: p + len - 1 });
      p += len + (rng.chance(0.22) ? 1 : 0); // alley gap
    }
    return out;
  };
  let courtN = 0;
  for (const B of blocks) {
    if (plazas.has(B)) continue;
    if (B.w < 9 || B.h < 9) {
      // Narrow block: a single row of houses across its short side, separated by alleys.
      const along = B.w >= B.h;
      for (const l of lots(along ? B.x : B.y, along ? B.x + B.w - 1 : B.y + B.h - 1))
        building(along ? { x: l.a, y: B.y, w: l.b - l.a + 1, h: B.h } : { x: B.x, y: l.a, w: B.w, h: l.b - l.a + 1 });
      continue;
    }
    const d = Math.max(3, Math.min(rng.int(4, 6), Math.floor((Math.min(B.w, B.h) - 3) / 2)));
    const back = () => (rng.chance(0.4) ? 1 : 0); // ragged back lines
    // Frontage along the top and bottom streets...
    for (const l of lots(B.x, B.x + B.w - 1)) {
      const b1 = back(),
        b2 = back();
      building({ x: l.a, y: B.y, w: l.b - l.a + 1, h: d - b1 });
      building({ x: l.a, y: B.y + B.h - d + b2, w: l.b - l.a + 1, h: d - b2 });
    }
    // ...and the left and right streets, between the corners.
    for (const l of lots(B.y + d + 1, B.y + B.h - d - 2)) {
      const b1 = back(),
        b2 = back();
      building({ x: B.x, y: l.a, w: d - b1, h: l.b - l.a + 1 });
      building({ x: B.x + B.w - d + b2, y: l.a, w: d - b2, h: l.b - l.a + 1 });
    }
    // Courtyard behind the houses; sometimes a back house closes off an alley (a dead end).
    const court: Rect = { x: B.x + d, y: B.y + d, w: B.w - 2 * d, h: B.h - 2 * d };
    if (court.w >= 5 && court.h >= 5 && rng.chance(0.5)) {
      const bw = rng.int(2, Math.min(4, court.w - 3)),
        bh = rng.int(2, Math.min(4, court.h - 3));
      building({ x: court.x + rng.int(1, court.w - bw - 1), y: court.y + rng.int(1, court.h - bh - 1), w: bw, h: bh });
    }
    for (let y = court.y; y < court.y + court.h; y++)
      for (let x = court.x; x < court.x + court.w; x++) if (get(x, y) === 'ground' && rng.chance(0.07)) set(x, y, rng.chance(0.5) ? 'tree' : 'brush');
    if (court.w >= 3 && court.h >= 3 && courtN < (walled ? 26 : 12)) {
      const c = rectCenter(court);
      if (get(c.x, c.y) === 'tree' || get(c.x, c.y) === 'brush') set(c.x, c.y, 'ground');
      if (get(c.x, c.y) === 'ground') {
        courtN++;
        rooms.push({ id: `court-${courtN}`, kind: 'room', rect: court, label: rng.chance(0.5) ? `Courtyard ${courtN}` : `Garden ${courtN}`, visibility: 'public' });
      }
    }
  }

  // Every courtyard must be reachable: if not, knock down the house(s) in the way to open an alley.
  const spawn = { x: 0, y: ys[aj].pos + 1 };
  let reach = reachable(map, spawn);
  for (const room of rooms) {
    const c = rectCenter(room.rect);
    if (reach[idx(map, c.x, c.y)]) continue;
    const targets = new Set<number>();
    reach.forEach((v, i) => v && targets.add(i));
    const path = route(W, H, (i) => (map.terrain[i] === 'wall' ? 6 : map.terrain[i] === 'deepwater' || map.terrain[i] === 'door' ? Infinity : 1), idx(map, c.x, c.y), targets, 0.2);
    for (const i of path) {
      if (map.terrain[i] !== 'wall') continue;
      const x = i % W,
        y = (i - x) / W;
      const hit = structures.findIndex((s) => s.type === 'building' && x >= s.rect.x && y >= s.rect.y && x < s.rect.x + s.rect.w && y < s.rect.y + s.rect.h);
      if (hit < 0) continue;
      const r = structures[hit].rect;
      for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) set(xx, yy, 'ground');
      structures.splice(hit, 1);
    }
    reach = reachable(map, spawn);
  }

  // Safety net: a place that still can't be reached isn't a place.
  const placed = rooms.filter((r) => {
    const c = rectCenter(r.rect);
    return reach[idx(map, c.x, c.y)] === 1;
  });
  map.spawn = spawn;
  map.objects = [...orderRooms(placed, spawn), ...doors, ...props.objects, ...structures];
  return { map, issues: validateDungeon(map) };
}
