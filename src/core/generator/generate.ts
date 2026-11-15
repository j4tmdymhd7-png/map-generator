/**
 * Seeded room-and-corridor dungeon generator.
 *
 * Same seed + params + GENERATOR_VERSION => identical map. Bump the version
 * whenever output for an existing seed would change.
 *
 * Pipeline: place rooms -> connect (MST + extra loops) -> carve L corridors
 * -> dead-end spurs -> wrap floor in walls -> doors at room entrances
 * -> stairs -> validate.
 */
import { createEmptyMap, EIGHT_WAY, idx, inBounds, rectCenter, rectContains, rectsOverlap, terrainAt } from '../model/grid';
import type { CorridorObject, DoorObject, DungeonMap, Point, Rect, RoomObject, StairsObject } from '../model/types';
import { createRng, type Rng } from '../rng';
import { validateDungeon, type ValidationIssue } from './validate';

export const GENERATOR_VERSION = 1;

export interface GeneratorParams {
  width: number;
  height: number;
  rooms: { min: number; max: number };
  roomSize: { min: number; max: number };
  /** 0..1 — chance to keep each non-tree connection (creates loops). */
  loopChance: number;
  /** Number of dead-end corridor spurs to add. */
  deadEnds: number;
  /** Chance a doorway gets a door at all (otherwise an open archway). */
  doorChance: number;
  /** Of generated doors, chance each starts open. */
  openDoorChance: number;
  /** Of generated doors, chance each starts locked (DM-only information). */
  lockedDoorChance: number;
  /** Place an entrance in the first room and an exit in the farthest room. */
  stairs: boolean;
}

export const DEFAULT_PARAMS: GeneratorParams = {
  width: 40,
  height: 40,
  rooms: { min: 8, max: 12 },
  roomSize: { min: 3, max: 8 },
  loopChance: 0.15,
  deadEnds: 2,
  doorChance: 0.8,
  openDoorChance: 0.25,
  lockedDoorChance: 0,
  stairs: true,
};

export interface GenerateResult {
  map: DungeonMap;
  issues: ValidationIssue[];
}

function placeRooms(rng: Rng, p: GeneratorParams): Rect[] {
  const target = rng.int(p.rooms.min, p.rooms.max);
  const rooms: Rect[] = [];
  const maxAttempts = target * 60;
  for (let attempt = 0; attempt < maxAttempts && rooms.length < target; attempt++) {
    const w = rng.int(p.roomSize.min, p.roomSize.max);
    const h = rng.int(p.roomSize.min, p.roomSize.max);
    // 1-square margin from the edge leaves room for the wall ring.
    if (w + 2 > p.width || h + 2 > p.height) continue;
    const r: Rect = { x: rng.int(1, p.width - w - 1), y: rng.int(1, p.height - h - 1), w, h };
    // Margin 2: each room keeps its own wall plus a gap of at least one square.
    if (rooms.some((o) => rectsOverlap(r, o, 2))) continue;
    rooms.push(r);
  }
  return rooms;
}

interface Edge {
  a: number;
  b: number;
  d: number;
}

/** Prim's MST over room centers, then probabilistic extra edges for loops. */
function connectRooms(rng: Rng, rooms: Rect[], loopChance: number): Edge[] {
  const centers = rooms.map(rectCenter);
  const dist = (i: number, j: number) => Math.abs(centers[i].x - centers[j].x) + Math.abs(centers[i].y - centers[j].y);
  const all: Edge[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) all.push({ a: i, b: j, d: dist(i, j) });
  all.sort((e, f) => e.d - f.d || e.a - f.a || e.b - f.b);

  if (rooms.length < 2) return [];
  const inTree = new Set([0]);
  const tree: Edge[] = [];
  while (inTree.size < rooms.length) {
    const e = all.find((x) => inTree.has(x.a) !== inTree.has(x.b))!;
    tree.push(e);
    inTree.add(e.a);
    inTree.add(e.b);
  }
  const extras = all.filter((e) => !tree.includes(e) && e.d < 30 && rng.chance(loopChance));
  return [...tree, ...extras];
}

function carveLine(map: DungeonMap, from: Point, to: Point, carved: Point[]): void {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x,
    y = from.y;
  for (;;) {
    if (terrainAt(map, x, y) === 'void') {
      map.terrain[idx(map, x, y)] = 'floor';
      carved.push({ x, y });
    }
    if (x === to.x && y === to.y) break;
    x += dx;
    y += dy;
  }
}

function carveCorridor(rng: Rng, map: DungeonMap, a: Rect, b: Rect): Point[] {
  const p = rectCenter(a);
  const q = rectCenter(b);
  const carved: Point[] = [];
  const corner = rng.chance(0.5) ? { x: q.x, y: p.y } : { x: p.x, y: q.y };
  carveLine(map, p, corner, carved);
  carveLine(map, corner, q, carved);
  return carved;
}

function addSpur(rng: Rng, map: DungeonMap, corridorCells: Point[]): Point[] {
  if (corridorCells.length === 0) return [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = rng.pick(corridorCells);
    const dir = rng.pick([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]);
    const len = rng.int(3, 7);
    const cells: Point[] = [];
    let ok = true;
    for (let i = 1; i <= len; i++) {
      const x = start.x + dir.x * i,
        y = start.y + dir.y * i;
      // Stay off the edge and don't touch any existing floor except where we started.
      if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) {
        ok = false;
        break;
      }
      const touchesFloor = EIGHT_WAY.some((d) => {
        const nx = x + d.x,
          ny = y + d.y;
        const isPrev = nx === x - dir.x && ny === y - dir.y;
        const isStartSide = Math.abs(nx - start.x) + Math.abs(ny - start.y) <= 1 && i === 1;
        return !isPrev && !isStartSide && terrainAt(map, nx, ny) === 'floor' && !cells.some((c) => c.x === nx && c.y === ny);
      });
      if (terrainAt(map, x, y) !== 'void' || touchesFloor) {
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

function wrapWalls(map: DungeonMap): void {
  const toWall: number[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (terrainAt(map, x, y) !== 'void') continue;
      if (EIGHT_WAY.some((d) => terrainAt(map, x + d.x, y + d.y) === 'floor')) toWall.push(idx(map, x, y));
    }
  for (const i of toWall) map.terrain[i] = 'wall';
}

/**
 * A doorway is a corridor square on a room's wall ring (not a ring corner)
 * with wall on both sides along the ring — i.e. a 1-wide opening into the room.
 */
function placeDoors(rng: Rng, map: DungeonMap, rooms: Rect[], p: GeneratorParams, nextId: () => string): DoorObject[] {
  const doors: DoorObject[] = [];
  const seen = new Set<number>();
  for (const r of rooms) {
    const ring: Point[] = [];
    for (let x = r.x; x < r.x + r.w; x++) ring.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
    for (let y = r.y; y < r.y + r.h; y++) ring.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
    for (const c of ring) {
      if (!inBounds(map, c.x, c.y) || terrainAt(map, c.x, c.y) !== 'floor') continue;
      if (rooms.some((o) => rectContains(o, c))) continue;
      const horizontalWall = c.y === r.y - 1 || c.y === r.y + r.h;
      const sideA = horizontalWall ? terrainAt(map, c.x - 1, c.y) : terrainAt(map, c.x, c.y - 1);
      const sideB = horizontalWall ? terrainAt(map, c.x + 1, c.y) : terrainAt(map, c.x, c.y + 1);
      if (sideA !== 'wall' || sideB !== 'wall') continue;
      const i = idx(map, c.x, c.y);
      if (seen.has(i)) continue;
      seen.add(i);
      if (!rng.chance(p.doorChance)) continue;
      const roll = rng.next();
      const state = roll < p.lockedDoorChance ? 'locked' : roll < p.lockedDoorChance + p.openDoorChance ? 'open' : 'closed';
      map.terrain[i] = 'door';
      doors.push({ id: nextId(), kind: 'door', at: c, state, visibility: 'public' });
    }
  }
  return doors;
}

export function generateDungeon(seed: string, overrides: Partial<GeneratorParams> = {}): GenerateResult {
  const p: GeneratorParams = { ...DEFAULT_PARAMS, ...overrides };
  const rng = createRng(`${GENERATOR_VERSION}:${seed}`);
  let counter = 0;
  const nextId = () => `obj-${++counter}`;

  const map = createEmptyMap({ id: `map-${seed}`, title: `Dungeon ${seed}`, width: p.width, height: p.height });
  map.generation = { seed, generatorVersion: GENERATOR_VERSION, params: { ...p } };

  const rects = placeRooms(rng, p);
  const roomObjs: RoomObject[] = rects.map((rect, i) => ({ id: nextId(), kind: 'room', rect, label: `Room ${i + 1}`, visibility: 'public' }));
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.terrain[idx(map, x, y)] = 'floor';

  const corridors: CorridorObject[] = [];
  const allCorridorCells: Point[] = [];
  for (const e of connectRooms(rng, rects, p.loopChance)) {
    const cells = carveCorridor(rng, map, rects[e.a], rects[e.b]);
    if (cells.length) {
      corridors.push({ id: nextId(), kind: 'corridor', cells, visibility: 'public' });
      allCorridorCells.push(...cells);
    }
  }
  for (let i = 0; i < p.deadEnds; i++) {
    const cells = addSpur(rng, map, allCorridorCells);
    if (cells.length) corridors.push({ id: nextId(), kind: 'corridor', cells, label: 'Dead end', visibility: 'public' });
  }

  wrapWalls(map);
  const doors = placeDoors(rng, map, rects, p, nextId);

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

  map.objects = [...roomObjs, ...corridors, ...doors, ...stairs];
  const issues = validateDungeon(map);
  if (rects.length < p.rooms.min)
    issues.push({ severity: 'warning', message: `Only fit ${rects.length} of at least ${p.rooms.min} rooms; try a larger map or smaller rooms.` });
  return { map, issues };
}
