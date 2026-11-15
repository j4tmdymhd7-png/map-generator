/**
 * Building interiors (small maps): taverns, inns and manors.
 *
 * The building footprint is split recursively (BSP) into rooms with one-square
 * walls. Every split gets one door, so every room is reachable. Rooms get a
 * role (common room, kitchen, bedroom…) and furniture to match. Each piece of
 * furniture is rolled back if it would cut a room off from its doors.
 */
import { createEmptyMap, idx, ORTHOGONAL, rectCenter, rectContains, setDifficult } from '../model/grid';
import type { DoorObject, DungeonMap, FurnitureObject, FurnitureType, Point, Rect, RoomObject, StairsObject } from '../model/types';
import { createRng, type Rng } from '../rng';
import type { GenerateResult } from './generate';
import { validateDungeon } from './validate';

export const INTERIOR_VERSION = 1;
export type InteriorKind = 'tavern' | 'manor';

interface Split {
  vertical: boolean; // wall runs top-to-bottom
  line: number; // x (vertical) or y (horizontal) of the wall
  from: number;
  to: number; // inclusive span along the wall
}

const MIN_ROOM = 4;

function bsp(rng: Rng, r: Rect, depth: number, keepWhole: (r: Rect, depth: number) => boolean, leaves: Rect[], splits: Split[]): void {
  const canV = r.w >= MIN_ROOM * 2 + 1;
  const canH = r.h >= MIN_ROOM * 2 + 1;
  if ((!canV && !canH) || keepWhole(r, depth)) {
    leaves.push(r);
    return;
  }
  const vertical = canV && (!canH || r.w > r.h * 1.2 || (r.w * 1.2 >= r.h && rng.chance(0.5)));
  const span = vertical ? r.w : r.h;
  const at = rng.int(MIN_ROOM, span - MIN_ROOM - 1);
  if (vertical) {
    splits.push({ vertical, line: r.x + at, from: r.y, to: r.y + r.h - 1 });
    bsp(rng, { x: r.x, y: r.y, w: at, h: r.h }, depth + 1, keepWhole, leaves, splits);
    bsp(rng, { x: r.x + at + 1, y: r.y, w: r.w - at - 1, h: r.h }, depth + 1, keepWhole, leaves, splits);
  } else {
    splits.push({ vertical, line: r.y + at, from: r.x, to: r.x + r.w - 1 });
    bsp(rng, { x: r.x, y: r.y, w: r.w, h: at }, depth + 1, keepWhole, leaves, splits);
    bsp(rng, { x: r.x, y: r.y + at + 1, w: r.w, h: r.h - at - 1 }, depth + 1, keepWhole, leaves, splits);
  }
}

const ROLES: Record<InteriorKind, { main: string; others: string[] }> = {
  tavern: { main: 'Common room', others: ['Kitchen', 'Storeroom', 'Guest room', 'Guest room', 'Private room', 'Guest room', 'Guest room', 'Pantry'] },
  manor: {
    main: 'Great hall',
    others: ['Kitchen', 'Storeroom', 'Study', 'Library', 'Master bedroom', 'Chapel', 'Bedroom', 'Servants’ quarters', 'Bedroom', 'Gallery', 'Pantry', 'Bedroom'],
  },
};

const SOLID: Record<FurnitureType, boolean> = {
  table: false,
  bed: false,
  counter: true,
  shelf: true,
  barrel: true,
  hearth: true,
  stall: true,
  well: true,
};

class Furnisher {
  objects: FurnitureObject[] = [];
  private n = 0;
  private map: DungeonMap;
  private rng: Rng;
  constructor(map: DungeonMap, rng: Rng) {
    this.map = map;
    this.rng = rng;
  }

  private roomOk(room: Rect): boolean {
    // Every free square in the room, and every doorway into it, must stay reachable from each other.
    const m = this.map;
    const free = (x: number, y: number) => {
      const t = m.terrain[idx(m, x, y)];
      return t === 'floor' || t === 'stairs';
    };
    const cells: number[] = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (free(x, y)) cells.push(idx(m, x, y));
    if (cells.length === 0) return false;
    const seen = new Set([cells[0]]);
    const q = [cells[0]];
    while (q.length) {
      const i = q.pop()!;
      const x = i % m.width,
        y = (i - x) / m.width;
      for (const d of ORTHOGONAL) {
        const nx = x + d.x,
          ny = y + d.y;
        if (!rectContains(room, { x: nx, y: ny })) continue;
        const ni = idx(m, nx, ny);
        if (!seen.has(ni) && free(nx, ny)) {
          seen.add(ni);
          q.push(ni);
        }
      }
    }
    if (seen.size !== cells.length) return false;
    // Doorways: squares just inside a door must be free.
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++)
        for (const d of ORTHOGONAL) if (m.terrain[idx(m, x + d.x, y + d.y)] === 'door' && !free(x, y)) return false;
    return true;
  }

  /** Place one piece if it fits on free floor, isn't on the room's center, and keeps the room connected. */
  place(room: Rect, type: FurnitureType, r: Rect): boolean {
    const m = this.map;
    const c = rectCenter(room);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!rectContains(room, { x, y }) || (x === c.x && y === c.y)) return false;
        const i = idx(m, x, y);
        if (m.terrain[i] !== 'floor' || m.flags[i] & 1) return false;
      }
    const before: [number, string, number][] = [];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = idx(m, x, y);
        before.push([i, m.terrain[i], m.flags[i]]);
        if (SOLID[type]) m.terrain[i] = 'furniture';
        else setDifficult(m, x, y, true);
      }
    if (!this.roomOk(room)) {
      for (const [i, t, f] of before) {
        m.terrain[i] = t as DungeonMap['terrain'][number];
        m.flags[i] = f;
      }
      return false;
    }
    this.objects.push({ id: `furn-${++this.n}`, kind: 'furniture', type, rect: r, visibility: 'public' });
    return true;
  }

  /** Along one wall of the room, a line of `type` pieces with gaps. */
  alongWall(room: Rect, type: FurnitureType, count: number) {
    for (let k = 0; k < count * 4 && count > 0; k++) {
      const side = this.rng.int(0, 3);
      const p: Point =
        side === 0
          ? { x: this.rng.int(room.x, room.x + room.w - 1), y: room.y }
          : side === 1
            ? { x: this.rng.int(room.x, room.x + room.w - 1), y: room.y + room.h - 1 }
            : side === 2
              ? { x: room.x, y: this.rng.int(room.y, room.y + room.h - 1) }
              : { x: room.x + room.w - 1, y: this.rng.int(room.y, room.y + room.h - 1) };
      if (this.place(room, type, { x: p.x, y: p.y, w: 1, h: 1 })) count--;
    }
  }

  furnish(room: Rect, role: string): StairsObject | null {
    const { rng } = this;
    const { x, y, w, h } = room;
    const tables = (spacingX: number, spacingY: number) => {
      for (let ty = y + 2; ty + 1 < y + h - 1; ty += spacingY)
        for (let tx = x + 1 + rng.int(0, 1); tx + 2 < x + w; tx += spacingX) this.place(room, 'table', { x: tx, y: ty, w: 2, h: 1 });
    };
    switch (role) {
      case 'Common room':
      case 'Great hall': {
        if (role === 'Common room') this.place(room, 'counter', { x: x + 1, y: y + 1, w: Math.min(5, w - 3), h: 1 });
        if (!this.place(room, 'hearth', { x: x + w - 1, y: y + Math.floor(h / 2) - 1, w: 1, h: 2 })) this.place(room, 'hearth', { x, y: y + Math.floor(h / 2) - 1, w: 1, h: 2 });
        tables(4, 3);
        if (role === 'Great hall') this.alongWall(room, 'shelf', 2);
        break;
      }
      case 'Kitchen':
        this.place(room, 'hearth', { x, y, w: 2, h: 1 });
        this.place(room, 'counter', { x: x + 1, y: y + h - 1, w: Math.max(1, w - 2), h: 1 });
        this.place(room, 'table', { x: x + 1, y: y + 2, w: 2, h: 1 });
        this.alongWall(room, 'barrel', 2);
        break;
      case 'Storeroom':
      case 'Pantry': {
        this.alongWall(room, 'barrel', Math.max(2, Math.floor((w + h) / 3)));
        this.alongWall(room, 'shelf', 2);
        if (role === 'Storeroom') {
          // Stairs down to the cellar: the way deeper in.
          for (let k = 0; k < 20; k++) {
            const p = { x: rng.int(x, x + w - 1), y: rng.int(y, y + h - 1) };
            const i = idx(this.map, p.x, p.y);
            if (this.map.terrain[i] !== 'floor') continue;
            this.map.terrain[i] = 'stairs';
            if (this.roomOk(room)) return { id: 'stairs-cellar', kind: 'stairs', at: p, role: 'exit', label: 'Cellar stairs', visibility: 'public' };
            this.map.terrain[i] = 'floor';
          }
        }
        break;
      }
      case 'Guest room':
      case 'Bedroom':
      case 'Master bedroom':
      case 'Servants’ quarters': {
        const beds = role === 'Servants’ quarters' ? 3 : role === 'Master bedroom' ? 1 : rng.int(1, 2);
        for (let b = 0; b < beds; b++) if (!this.place(room, 'bed', { x: x + b * 2, y, w: 1, h: 2 })) this.place(room, 'bed', { x: x + w - 1 - b * 2, y: y + h - 2, w: 1, h: 2 });
        this.alongWall(room, rng.chance(0.5) ? 'shelf' : 'barrel', 1);
        break;
      }
      case 'Study':
      case 'Library':
        this.alongWall(room, 'shelf', role === 'Library' ? w + h : 3);
        this.place(room, 'table', { x: x + Math.floor(w / 2) - 1, y: y + 1, w: 2, h: 1 });
        break;
      case 'Chapel':
        this.place(room, 'counter', { x: x + Math.floor(w / 2) - 1, y, w: 2, h: 1 }); // altar
        tables(3, 2); // pews
        break;
      default:
        tables(4, 3);
    }
    return null;
  }
}

export function generateInterior(seed: string, kind: InteriorKind): GenerateResult {
  const rng = createRng(`interior:${INTERIOR_VERSION}:${kind}:${seed}`);
  const W = kind === 'tavern' ? 28 : 38;
  const H = kind === 'tavern' ? 22 : 30;
  const map = createEmptyMap({ id: `map-small-${kind}-${seed}`, title: `${kind === 'tavern' ? 'Tavern' : 'Manor'} ${seed}`, width: W, height: H, fill: 'ground' });
  map.style = 'interior';
  map.generation = { seed, generatorVersion: INTERIOR_VERSION, params: { kind } };

  // Street along the top; the building sits below it with a yard around.
  for (let y = 1; y <= 2; y++) for (let x = 0; x < W; x++) map.terrain[idx(map, x, y)] = 'road';
  const B: Rect = { x: 3, y: 4, w: W - 6, h: H - 7 };
  for (let y = B.y; y < B.y + B.h; y++)
    for (let x = B.x; x < B.x + B.w; x++) {
      const edge = x === B.x || y === B.y || x === B.x + B.w - 1 || y === B.y + B.h - 1;
      map.terrain[idx(map, x, y)] = edge ? 'wall' : 'floor';
    }
  const inner: Rect = { x: B.x + 1, y: B.y + 1, w: B.w - 2, h: B.h - 2 };

  // Split off the main room first (front of the building), then the rest.
  const leaves: Rect[] = [];
  const splits: Split[] = [];
  const mainH = Math.max(MIN_ROOM + 1, Math.round(inner.h * (kind === 'tavern' ? 0.55 : 0.4)));
  const main: Rect = { x: inner.x, y: inner.y, w: inner.w, h: mainH };
  splits.push({ vertical: false, line: inner.y + mainH, from: inner.x, to: inner.x + inner.w - 1 });
  const back: Rect = { x: inner.x, y: inner.y + mainH + 1, w: inner.w, h: inner.h - mainH - 1 };
  const maxRooms = kind === 'tavern' ? 6 : 11;
  bsp(rng, back, 0, (r, d) => r.w * r.h <= 30 || (d >= 2 && rng.chance(0.35)) || leaves.length >= maxRooms - 1, leaves, splits);
  // The manor's great hall can lose a wing to a side room.
  if (kind === 'manor' && main.w >= 22) {
    const cut = main.w - rng.int(6, 8);
    splits.push({ vertical: true, line: main.x + cut, from: main.y, to: main.y + main.h - 1 });
    leaves.unshift({ x: main.x + cut + 1, y: main.y, w: main.w - cut - 1, h: main.h });
    main.w = cut;
  }
  for (const s of splits)
    for (let k = s.from; k <= s.to; k++) map.terrain[idx(map, s.vertical ? s.line : k, s.vertical ? k : s.line)] = 'wall';

  // One door per split, where both sides are open floor.
  const doors: DoorObject[] = [];
  let dn = 0;
  for (const s of splits) {
    const options: Point[] = [];
    for (let k = s.from; k <= s.to; k++) {
      const p = s.vertical ? { x: s.line, y: k } : { x: k, y: s.line };
      const a = s.vertical ? map.terrain[idx(map, p.x - 1, p.y)] : map.terrain[idx(map, p.x, p.y - 1)];
      const b = s.vertical ? map.terrain[idx(map, p.x + 1, p.y)] : map.terrain[idx(map, p.x, p.y + 1)];
      if (a === 'floor' && b === 'floor') options.push(p);
    }
    if (!options.length) continue;
    const p = rng.pick(options);
    map.terrain[idx(map, p.x, p.y)] = 'door';
    doors.push({ id: `door-${++dn}`, kind: 'door', at: p, state: rng.chance(0.4) ? 'open' : 'closed', visibility: 'public' });
  }
  // Front door from the street into the main room.
  const fx = rng.int(main.x + 1, main.x + main.w - 2);
  map.terrain[idx(map, fx, B.y)] = 'door';
  doors.push({ id: `door-${++dn}`, kind: 'door', at: { x: fx, y: B.y }, state: 'closed', label: 'Front door', visibility: 'public' });
  for (let y = 3; y < B.y; y++) map.terrain[idx(map, fx, y)] = 'road'; // path to the door
  map.spawn = { x: fx, y: 2 };

  // Yard: a few trees and bushes (a garden for the manor), never on the path.
  const yardFeatures = kind === 'manor' ? 40 : 10;
  for (let k = 0; k < yardFeatures; k++) {
    const x = rng.int(0, W - 1),
      y = rng.int(3, H - 1);
    const i = idx(map, x, y);
    if (map.terrain[i] !== 'ground' || Math.abs(x - fx) <= 1) continue;
    const nearWall = ORTHOGONAL.some((d) => map.terrain[idx(map, x + d.x, y + d.y)] === 'wall');
    if (!nearWall) map.terrain[i] = rng.chance(0.4) ? 'tree' : 'brush';
  }

  // Roles and furniture
  const roles = ROLES[kind];
  const rooms: { rect: Rect; role: string }[] = [{ rect: main, role: roles.main }];
  const sorted = [...leaves].sort((a, b) => b.w * b.h - a.w * a.h);
  sorted.forEach((r, i) => rooms.push({ rect: r, role: roles.others[i % roles.others.length] }));
  // The storeroom (with the cellar stairs) should be the room farthest from the front door.
  const far = rooms.slice(1).reduce((best, r) => (rectCenter(r.rect).y > rectCenter(best.rect).y ? r : best), rooms[1] ?? rooms[0]);
  const storeIdx = rooms.findIndex((r) => r.role === 'Storeroom');
  if (far && storeIdx > 0 && far !== rooms[storeIdx]) [far.role, rooms[storeIdx].role] = [rooms[storeIdx].role, far.role];

  const furnisher = new Furnisher(map, rng);
  const stairs: StairsObject[] = [];
  for (const r of rooms) {
    const s = furnisher.furnish(r.rect, r.role);
    if (s) stairs.push(s);
  }

  const count: Record<string, number> = {};
  const roomObjs: RoomObject[] = rooms.map((r, i) => {
    count[r.role] = (count[r.role] ?? 0) + 1;
    const dup = rooms.filter((x) => x.role === r.role).length > 1;
    return { id: `room-${i + 1}`, kind: 'room', rect: r.rect, shape: 'rect', label: dup ? `${r.role} ${count[r.role]}` : r.role, visibility: 'public' };
  });
  // Lair last (the room with the cellar stairs), so encounters and the hoard land there.
  const lairIdx = stairs.length ? roomObjs.findIndex((r) => rectContains(r.rect, stairs[0].at)) : -1;
  if (lairIdx > 0) roomObjs.push(...roomObjs.splice(lairIdx, 1));

  map.objects = [...roomObjs, ...doors, ...stairs, ...furnisher.objects];
  return { map, issues: validateDungeon(map) };
}
