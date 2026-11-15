/**
 * Seeded dungeon generator.
 *
 * Same seed + params + GENERATOR_VERSION => identical map. Bump the version
 * whenever output for an existing seed would change.
 *
 * Pipeline: place room footprints -> pick shapes and carve masks
 * -> connect (MST + loops) -> route corridors (cost-based, reusing earlier
 * corridors and steering clear of other rooms) -> dead-end spurs
 * -> furnish rooms -> wrap floor in walls -> doors -> stairs -> validate.
 */
import { createEmptyMap, EIGHT_WAY, idx, ORTHOGONAL, rectCenter, rectsOverlap, setDifficult, terrainAt } from '../model/grid';
import type { CorridorObject, DoorObject, DungeonMap, Point, Rect, RoomObject, RoomShape, StairsObject } from '../model/types';
import { createRng, type Rng } from '../rng';
import { validateDungeon, type ValidationIssue } from './validate';

export const GENERATOR_VERSION = 2;

export type Theme = 'dungeon' | 'cave';

export interface GeneratorParams {
  width: number;
  height: number;
  /** 'dungeon' = built halls and passages; 'cave' = natural caverns and winding tunnels. */
  theme: Theme;
  rooms: { min: number; max: number };
  roomSize: { min: number; max: number };
  /** 0..1 — chance to keep each non-tree connection (creates loops). */
  loopChance: number;
  /** Number of dead-end corridor spurs to add. */
  deadEnds: number;
  /** 0..1 — how many rooms get furnishings (pillars, rubble, pits, statues). */
  furnishing: number;
  /** Chance a doorway gets a door at all (otherwise an open archway). */
  doorChance: number;
  /** Of generated doors, chance each starts open. */
  openDoorChance: number;
  /** Of generated doors, chance each starts locked. */
  lockedDoorChance: number;
  /** Place an entrance in the first room and an exit in the farthest room. */
  stairs: boolean;
}

export const DEFAULT_PARAMS: GeneratorParams = {
  width: 40,
  height: 40,
  theme: 'dungeon',
  rooms: { min: 8, max: 12 },
  roomSize: { min: 3, max: 9 },
  loopChance: 0.15,
  deadEnds: 2,
  furnishing: 0.6,
  doorChance: 0.8,
  openDoorChance: 0.25,
  lockedDoorChance: 0,
  stairs: true,
};

export interface GenerateResult {
  map: DungeonMap;
  issues: ValidationIssue[];
}

interface Room {
  rect: Rect;
  shape: RoomShape;
  /** Cell indices (map coordinates) inside the room. */
  cells: Set<number>;
}

// ---------------------------------------------------------------------------
// Rooms

function placeRects(rng: Rng, p: GeneratorParams): Rect[] {
  const target = rng.int(p.rooms.min, p.rooms.max);
  const rooms: Rect[] = [];
  const maxAttempts = target * 80;
  for (let attempt = 0; attempt < maxAttempts && rooms.length < target; attempt++) {
    const w = rng.int(p.roomSize.min, p.roomSize.max);
    const h = rng.int(p.roomSize.min, p.roomSize.max);
    if (w + 4 > p.width || h + 4 > p.height) continue;
    // 2-square margin from the edge keeps corridors and walls inside the map.
    const r: Rect = { x: rng.int(2, p.width - w - 2), y: rng.int(2, p.height - h - 2), w, h };
    // Margin 2: each room keeps its own wall plus a gap of at least one square.
    if (rooms.some((o) => rectsOverlap(r, o, 2))) continue;
    rooms.push(r);
  }
  return rooms;
}

function pickShape(rng: Rng, r: Rect, theme: Theme): RoomShape {
  const small = r.w < 5 || r.h < 5;
  const weights: [RoomShape, number][] =
    theme === 'cave'
      ? [
          ['cave', 0.85],
          ['round', small ? 0 : 0.15],
        ]
      : [
          ['rect', 0.5],
          ['round', small ? 0 : 0.18],
          ['cross', small ? 0 : 0.17],
          ['cave', small ? 0 : 0.15],
        ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [shape, w] of weights) {
    roll -= w;
    if (roll < 0) return shape;
  }
  return small && theme === 'cave' ? 'cave' : 'rect';
}

/** Which squares of the bounding box belong to the room. The center is always included. */
function shapeMask(rng: Rng, r: Rect, shape: RoomShape): (lx: number, ly: number) => boolean {
  const cx = r.w / 2,
    cy = r.h / 2;
  switch (shape) {
    case 'rect':
      return () => true;
    case 'round':
      return (lx, ly) => ((lx + 0.5 - cx) / cx) ** 2 + ((ly + 0.5 - cy) / cy) ** 2 <= 1.08;
    case 'cross': {
      const bw = Math.max(1, Math.round(r.w * 0.4)),
        bh = Math.max(1, Math.round(r.h * 0.4));
      const x0 = Math.floor((r.w - bw) / 2),
        y0 = Math.floor((r.h - bh) / 2);
      return (lx, ly) => (lx >= x0 && lx < x0 + bw) || (ly >= y0 && ly < y0 + bh);
    }
    case 'cave': {
      // Star-shaped blob: an ellipse whose radius wobbles with angle, so it's
      // always connected to its center.
      const ph1 = rng.next() * Math.PI * 2,
        ph2 = rng.next() * Math.PI * 2,
        ph3 = rng.next() * Math.PI * 2;
      const a1 = 0.12 + rng.next() * 0.1,
        a2 = 0.08 + rng.next() * 0.08;
      return (lx, ly) => {
        const dx = (lx + 0.5 - cx) / cx,
          dy = (ly + 0.5 - cy) / cy;
        const ang = Math.atan2(dy, dx);
        const radius = 1 + a1 * Math.sin(2 * ang + ph1) + a2 * Math.sin(3 * ang + ph2) + 0.06 * Math.sin(5 * ang + ph3);
        return Math.hypot(dx, dy) <= radius * 0.98;
      };
    }
  }
}

function buildRoom(rng: Rng, map: DungeonMap, rect: Rect, theme: Theme): Room {
  const shape = pickShape(rng, rect, theme);
  const inside = shapeMask(rng, rect, shape);
  const cells = new Set<number>();
  for (let ly = 0; ly < rect.h; ly++)
    for (let lx = 0; lx < rect.w; lx++) if (inside(lx, ly)) cells.add(idx(map, rect.x + lx, rect.y + ly));
  const c = rectCenter(rect);
  cells.add(idx(map, c.x, c.y));
  for (const i of cells) map.terrain[i] = 'floor';
  return { rect, shape, cells };
}

// ---------------------------------------------------------------------------
// Connections

interface Edge {
  a: number;
  b: number;
  d: number;
}

/** Prim's MST over room centers, then probabilistic extra edges for loops. */
function connectRooms(rng: Rng, rects: Rect[], loopChance: number): Edge[] {
  const centers = rects.map(rectCenter);
  const dist = (i: number, j: number) => Math.abs(centers[i].x - centers[j].x) + Math.abs(centers[i].y - centers[j].y);
  const all: Edge[] = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) all.push({ a: i, b: j, d: dist(i, j) });
  all.sort((e, f) => e.d - f.d || e.a - f.a || e.b - f.b);

  if (rects.length < 2) return [];
  const inTree = new Set([0]);
  const tree: Edge[] = [];
  while (inTree.size < rects.length) {
    const e = all.find((x) => inTree.has(x.a) !== inTree.has(x.b))!;
    tree.push(e);
    inTree.add(e.a);
    inTree.add(e.b);
  }
  const extras = all.filter((e) => !tree.includes(e) && e.d < 30 && rng.chance(loopChance));
  return [...tree, ...extras];
}

/**
 * Route a corridor between two room centers with Dijkstra over (cell, heading).
 * Costs steer it to reuse earlier corridors, keep off other rooms' walls, avoid
 * running alongside existing corridors, and (in dungeons) prefer straight runs.
 */
function routeCorridor(
  map: DungeonMap,
  roomAt: Int16Array,
  corridor: Uint8Array,
  noise: Float32Array,
  from: number,
  to: number,
  roomA: number,
  roomB: number,
  theme: Theme,
): number[] {
  const W = map.width,
    H = map.height,
    n = W * H;
  const turnCost = theme === 'cave' ? 0.6 : 3;
  const wind = theme === 'cave' ? 5 : 1.5;

  const enterCost = (i: number): number => {
    const x = i % W,
      y = (i - x) / W;
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return Infinity;
    const r = roomAt[i];
    if (r === roomA || r === roomB) return 1;
    if (r >= 0) return 8; // cutting through another room is allowed but discouraged
    if (corridor[i]) return 1; // reuse existing passages
    let cost = 2 + noise[i] * wind;
    for (const d of EIGHT_WAY) {
      const nx = x + d.x,
        ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      const nr = roomAt[ni];
      if (nr >= 0 && nr !== roomA && nr !== roomB) {
        cost += 12; // don't hug other rooms
        break;
      }
    }
    for (const d of ORTHOGONAL) {
      const ni = (y + d.y) * W + (x + d.x);
      if (corridor[ni]) {
        cost += 3; // don't run parallel to an existing corridor
        break;
      }
    }
    return cost;
  };

  const dist = new Float64Array(n * 4).fill(Infinity);
  const prev = new Int32Array(n * 4).fill(-1);
  // Tiny binary heap of [cost, state]
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
  const pop = (): [number, number] => {
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

  for (let dir = 0; dir < 4; dir++) {
    dist[from * 4 + dir] = 0;
    push(0, from * 4 + dir);
  }
  let end = -1;
  while (heap.length) {
    const [c, s] = pop();
    if (c > dist[s]) continue;
    const cell = s >> 2,
      dir = s & 3;
    if (cell === to) {
      end = s;
      break;
    }
    const x = cell % W,
      y = (cell - x) / W;
    for (let nd = 0; nd < 4; nd++) {
      const d = ORTHOGONAL[nd];
      const nx = x + d.x,
        ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      const step = enterCost(ni);
      if (!Number.isFinite(step)) continue;
      const nc = c + step + (nd === dir ? 0 : turnCost);
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

function addSpur(rng: Rng, map: DungeonMap, roomAt: Int16Array, corridorCells: Point[]): Point[] {
  if (corridorCells.length === 0) return [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const start = rng.pick(corridorCells);
    const dir = rng.pick(ORTHOGONAL);
    const len = rng.int(3, 7);
    const cells: Point[] = [];
    let ok = true;
    for (let i = 1; i <= len; i++) {
      const x = start.x + dir.x * i,
        y = start.y + dir.y * i;
      if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) {
        ok = false;
        break;
      }
      // Must stay clear of every existing open square except the one we branched from.
      const crowded = EIGHT_WAY.some((d) => {
        const nx = x + d.x,
          ny = y + d.y;
        if (cells.some((c) => c.x === nx && c.y === ny)) return false;
        if (i === 1 && Math.abs(nx - start.x) + Math.abs(ny - start.y) <= 1) return false;
        if (nx === x - dir.x && ny === y - dir.y) return false;
        return terrainAt(map, nx, ny) !== 'void' || roomAt[idx(map, nx, ny)] >= 0;
      });
      if (terrainAt(map, x, y) !== 'void' || crowded) {
        ok = false;
        break;
      }
      cells.push({ x, y });
    }
    if (ok && cells.length >= 3) {
      for (const c of cells) map.terrain[idx(map, c.x, c.y)] = 'floor';
      return cells;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Furnishings

/** Squares deep inside the room (all eight neighbors are room squares), excluding the area around the center. */
function interiorCells(map: DungeonMap, room: Room): Point[] {
  const c = rectCenter(room.rect);
  const out: Point[] = [];
  for (const i of room.cells) {
    const x = i % map.width,
      y = (i - x) / map.width;
    if (Math.abs(x - c.x) <= 1 && Math.abs(y - c.y) <= 1) continue;
    if (EIGHT_WAY.every((d) => room.cells.has(idx(map, x + d.x, y + d.y)))) out.push({ x, y });
  }
  return out;
}

/** Every room square that touches open floor outside the room must still be reachable from the center. */
function roomStillConnected(map: DungeonMap, room: Room): boolean {
  const passable = (i: number) => map.terrain[i] === 'floor' || map.terrain[i] === 'stairs';
  const c = rectCenter(room.rect);
  const start = idx(map, c.x, c.y);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % map.width,
      y = (i - x) / map.width;
    for (const d of ORTHOGONAL) {
      const ni = idx(map, x + d.x, y + d.y);
      if (room.cells.has(ni) && !seen.has(ni) && passable(ni)) {
        seen.add(ni);
        queue.push(ni);
      }
    }
  }
  for (const i of room.cells) {
    const x = i % map.width,
      y = (i - x) / map.width;
    const entry = ORTHOGONAL.some((d) => {
      const ni = idx(map, x + d.x, y + d.y);
      return !room.cells.has(ni) && terrainAt(map, x + d.x, y + d.y) === 'floor';
    });
    if (entry && !seen.has(i)) return false;
  }
  return true;
}

function furnishRoom(rng: Rng, map: DungeonMap, room: Room, theme: Theme): void {
  const interior = interiorCells(map, room);
  if (interior.length === 0) return;
  const snapshot = new Map<number, [string, number]>();
  const remember = (x: number, y: number) => {
    const i = idx(map, x, y);
    if (!snapshot.has(i)) snapshot.set(i, [map.terrain[i], map.flags[i]]);
  };
  const set = (x: number, y: number, t: 'obstacle' | 'pit') => {
    remember(x, y);
    map.terrain[idx(map, x, y)] = t;
  };

  const { rect } = room;
  const options: string[] =
    theme === 'cave'
      ? ['rubble', 'rubble', 'rubble', 'pit', 'pillar']
      : room.shape === 'rect' && rect.w >= 5 && rect.h >= 5
        ? ['colonnade', 'colonnade', 'rubble', 'pit', 'statue']
        : ['rubble', 'pit', 'statue'];
  const choice = rng.pick(options);

  if (choice === 'colonnade') {
    // Two rows of pillars one square in from the long walls.
    const horizontal = rect.w >= rect.h;
    const along = horizontal ? rect.w : rect.h;
    for (let k = 1; k < along - 1; k += 2) {
      const a = horizontal ? { x: rect.x + k, y: rect.y + 1 } : { x: rect.x + 1, y: rect.y + k };
      const b = horizontal ? { x: rect.x + k, y: rect.y + rect.h - 2 } : { x: rect.x + rect.w - 2, y: rect.y + k };
      for (const p of [a, b]) if (interior.some((q) => q.x === p.x && q.y === p.y)) set(p.x, p.y, 'obstacle');
    }
  } else if (choice === 'rubble') {
    // Grow a blob of difficult terrain from a random interior square.
    const seed = rng.pick(interior);
    const target = rng.int(3, Math.min(10, Math.max(3, Math.floor(room.cells.size / 3))));
    const blob = [seed];
    const inBlob = new Set([idx(map, seed.x, seed.y)]);
    for (let guard = 0; blob.length < target && guard < 60; guard++) {
      const from = rng.pick(blob);
      const d = rng.pick(ORTHOGONAL);
      const nx = from.x + d.x,
        ny = from.y + d.y;
      const ni = idx(map, nx, ny);
      if (room.cells.has(ni) && !inBlob.has(ni)) {
        inBlob.add(ni);
        blob.push({ x: nx, y: ny });
      }
    }
    for (const p of blob) {
      remember(p.x, p.y);
      setDifficult(map, p.x, p.y, true);
    }
  } else if (choice === 'pit') {
    const p = rng.pick(interior);
    set(p.x, p.y, 'pit');
  } else {
    // statue / pillar: a single solid feature
    const p = rng.pick(interior);
    set(p.x, p.y, 'obstacle');
  }

  if (!roomStillConnected(map, room)) {
    for (const [i, [t, f]] of snapshot) {
      map.terrain[i] = t as DungeonMap['terrain'][number];
      map.flags[i] = f;
    }
  }
}

/**
 * Caves only: erode the rock next to open ground so tunnels widen unevenly
 * and chamber edges go ragged, then fill notches and tiny rock islands.
 * Only ever turns rock into floor, so connectivity can't get worse.
 */
function roughenCaves(rng: Rng, map: DungeonMap): void {
  const W = map.width,
    H = map.height;
  const openCount = (x: number, y: number) =>
    EIGHT_WAY.reduce((n, d) => n + (terrainAt(map, x + d.x, y + d.y) !== 'void' ? 1 : 0), 0);
  const pass = (minOpen: number, chance: number) => {
    const flip: number[] = [];
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        if (terrainAt(map, x, y) !== 'void') continue;
        const k = openCount(x, y);
        // Roll for every candidate so the stream doesn't depend on earlier flips.
        if (k >= minOpen && rng.chance(chance)) flip.push(idx(map, x, y));
      }
    for (const i of flip) map.terrain[i] = 'floor';
  };
  pass(3, 0.22);
  pass(6, 1);
}

// ---------------------------------------------------------------------------
// Walls and doors

function wrapWalls(map: DungeonMap): void {
  const toWall: number[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (terrainAt(map, x, y) !== 'void') continue;
      if (EIGHT_WAY.some((d) => { const t = terrainAt(map, x + d.x, y + d.y); return t !== 'void' && t !== 'wall'; }))
        toWall.push(idx(map, x, y));
    }
  for (const i of toWall) map.terrain[i] = 'wall';
}

/**
 * A doorway is a corridor square (outside every room) that opens straight
 * into a room, with wall on both sides of it — a 1-wide gap in the room's wall.
 */
function placeDoors(rng: Rng, map: DungeonMap, roomAt: Int16Array, corridorCells: Point[], p: GeneratorParams, nextId: () => string): DoorObject[] {
  const doors: DoorObject[] = [];
  const seen = new Set<number>();
  const isWall = (x: number, y: number) => terrainAt(map, x, y) === 'wall';
  for (const c of corridorCells) {
    const i = idx(map, c.x, c.y);
    if (seen.has(i) || roomAt[i] >= 0 || map.terrain[i] !== 'floor') continue;
    for (const d of ORTHOGONAL) {
      const ri = idx(map, c.x + d.x, c.y + d.y);
      if (roomAt[ri] < 0) continue;
      // Perpendicular neighbors must both be wall.
      const sideA = d.x !== 0 ? isWall(c.x, c.y - 1) : isWall(c.x - 1, c.y);
      const sideB = d.x !== 0 ? isWall(c.x, c.y + 1) : isWall(c.x + 1, c.y);
      // And the square behind (away from the room) must be open corridor, not another room.
      const back = idx(map, c.x - d.x, c.y - d.y);
      if (!sideA || !sideB || roomAt[back] >= 0 || terrainAt(map, c.x - d.x, c.y - d.y) !== 'floor') continue;
      seen.add(i);
      if (!rng.chance(p.doorChance)) break;
      const roll = rng.next();
      const state = roll < p.lockedDoorChance ? 'locked' : roll < p.lockedDoorChance + p.openDoorChance ? 'open' : 'closed';
      map.terrain[i] = 'door';
      doors.push({ id: nextId(), kind: 'door', at: { x: c.x, y: c.y }, state, visibility: 'public' });
      break;
    }
  }
  return doors;
}

// ---------------------------------------------------------------------------

export function generateDungeon(seed: string, overrides: Partial<GeneratorParams> = {}): GenerateResult {
  const p: GeneratorParams = { ...DEFAULT_PARAMS, ...overrides };
  const rng = createRng(`${GENERATOR_VERSION}:${seed}`);
  let counter = 0;
  const nextId = () => `obj-${++counter}`;

  const map = createEmptyMap({ id: `map-${seed}`, title: `Dungeon ${seed}`, width: p.width, height: p.height });
  map.generation = { seed, generatorVersion: GENERATOR_VERSION, params: { ...p } };
  const n = p.width * p.height;

  // Rooms
  const rects = placeRects(rng, p);
  const rooms = rects.map((r) => buildRoom(rng, map, r, p.theme));
  const roomAt = new Int16Array(n).fill(-1);
  rooms.forEach((r, ri) => r.cells.forEach((i) => (roomAt[i] = ri)));

  // Corridors
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng.next();
  const corridor = new Uint8Array(n);
  const corridors: CorridorObject[] = [];
  const allCorridorCells: Point[] = [];
  for (const e of connectRooms(rng, rects, p.loopChance)) {
    const a = rectCenter(rects[e.a]),
      b = rectCenter(rects[e.b]);
    const path = routeCorridor(map, roomAt, corridor, noise, idx(map, a.x, a.y), idx(map, b.x, b.y), e.a, e.b, p.theme);
    const cells: Point[] = [];
    for (const i of path) {
      if (roomAt[i] >= 0 || corridor[i]) continue;
      corridor[i] = 1;
      map.terrain[i] = 'floor';
      const x = i % map.width;
      cells.push({ x, y: (i - x) / map.width });
    }
    // Passing through a third room is fine; the corridor squares themselves stay outside rooms.
    if (cells.length) {
      corridors.push({ id: nextId(), kind: 'corridor', cells, visibility: 'public' });
      allCorridorCells.push(...cells);
    }
  }
  for (let i = 0; i < p.deadEnds; i++) {
    const cells = addSpur(rng, map, roomAt, allCorridorCells);
    if (cells.length) {
      cells.forEach((c) => (corridor[idx(map, c.x, c.y)] = 1));
      corridors.push({ id: nextId(), kind: 'corridor', cells, label: 'Dead end', visibility: 'public' });
    }
  }

  if (p.theme === 'cave') roughenCaves(rng, map);

  // Furnishings (before walls, so solid features never touch the wall pass)
  for (const room of rooms) if (rng.chance(p.furnishing)) furnishRoom(rng, map, room, p.theme);

  wrapWalls(map);
  const doors = p.theme === 'cave' ? [] : placeDoors(rng, map, roomAt, allCorridorCells, p, nextId);

  // Stairs
  const stairs: StairsObject[] = [];
  if (p.stairs && rects.length > 0) {
    const entrance = rectCenter(rects[0]);
    let far = 0,
      best = -1;
    rects.forEach((r, i) => {
      const c = rectCenter(r);
      const d = Math.abs(c.x - entrance.x) + Math.abs(c.y - entrance.y);
      if (d > best) {
        best = d;
        far = i;
      }
    });
    map.terrain[idx(map, entrance.x, entrance.y)] = 'stairs';
    stairs.push({ id: nextId(), kind: 'stairs', at: entrance, role: 'entrance', label: 'Entrance', visibility: 'public' });
    if (far !== 0) {
      const exit = rectCenter(rects[far]);
      map.terrain[idx(map, exit.x, exit.y)] = 'stairs';
      stairs.push({ id: nextId(), kind: 'stairs', at: exit, role: 'exit', label: 'Exit', visibility: 'public' });
    }
  }

  const roomObjs: RoomObject[] = rooms.map((r, i) => ({
    id: nextId(),
    kind: 'room',
    rect: r.rect,
    shape: r.shape,
    label: p.theme === 'cave' ? `Cavern ${i + 1}` : `Room ${i + 1}`,
    visibility: 'public',
  }));
  map.objects = [...roomObjs, ...corridors, ...doors, ...stairs];
  const issues = validateDungeon(map);
  if (rects.length < p.rooms.min)
    issues.push({ severity: 'warning', message: `Only fit ${rects.length} of at least ${p.rooms.min} rooms; try a larger map or smaller rooms.` });
  return { map, issues };
}
