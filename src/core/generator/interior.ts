/**
 * Building interiors (small maps): taverns, inns and manors.
 *
 * The building footprint is split recursively (BSP) into rooms with one-square
 * walls. Every split gets one door, so every room is reachable. Rooms get a
 * role (common room, kitchen, bedroom…) and furniture to match. Each piece of
 * furniture is rolled back if it would cut a room off from its doors.
 */
import { createEmptyMap, idx, ORTHOGONAL, rectCenter, rectContains, setDifficult } from '../model/grid';
import type { DoorObject, DungeonMap, FurnitureFacing, FurnitureObject, FurnitureType, Point, Rect, RoomObject, StairsObject } from '../model/types';
import { createRng, type Rng } from '../rng';
import type { GenerateResult } from './generate';
import { validateDungeon } from './validate';

export const INTERIOR_VERSION = 3;
export type InteriorKind = 'tavern' | 'inn' | 'manor' | 'shop' | 'smithy' | 'temple' | 'barracks' | 'den' | 'warehouse' | 'stables' | 'cottage';

interface Split {
  vertical: boolean; // wall runs top-to-bottom
  line: number; // x (vertical) or y (horizontal) of the wall
  from: number;
  to: number; // inclusive span along the wall
  door?: boolean;
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

interface Plan {
  title: string;
  w: number;
  h: number;
  /** Share of the inside depth given to the front room. */
  front: number;
  maxRooms: number;
  main: string;
  others: string[];
}

const PLANS: Record<InteriorKind, Plan> = {
  tavern: { title: 'Tavern', w: 28, h: 26, front: 0.42, maxRooms: 6, main: 'Common room', others: ['Kitchen', 'Storeroom', 'Guest room', 'Guest room', 'Private room', 'Guest room', 'Guest room', 'Pantry'] },
  inn: { title: 'Inn', w: 32, h: 32, front: 0.42, maxRooms: 9, main: 'Common room', others: ['Kitchen', 'Storeroom', 'Guest room', 'Guest room', 'Guest room', 'Guest room', 'Private room', 'Guest room', 'Pantry'] },
  manor: {
    title: 'Manor',
    w: 38,
    h: 30,
    front: 0.4,
    maxRooms: 11,
    main: 'Great hall',
    others: ['Kitchen', 'Storeroom', 'Study', 'Library', 'Master bedroom', 'Chapel', 'Bedroom', 'Servants’ quarters', 'Bedroom', 'Gallery', 'Pantry', 'Bedroom'],
  },
  shop: { title: 'Shop', w: 22, h: 18, front: 0.5, maxRooms: 3, main: 'Shop floor', others: ['Storeroom', 'Workshop', 'Bedroom'] },
  smithy: { title: 'Smithy', w: 24, h: 18, front: 0.55, maxRooms: 3, main: 'Forge', others: ['Storeroom', 'Workshop', 'Bedroom'] },
  temple: { title: 'Temple', w: 30, h: 28, front: 0.58, maxRooms: 5, main: 'Nave', others: ['Vestry', 'Storeroom', 'Shrine room', 'Cell', 'Cell'] },
  barracks: { title: 'Barracks', w: 28, h: 22, front: 0.4, maxRooms: 6, main: 'Guard room', others: ['Bunk room', 'Armory', 'Storeroom', 'Captain’s office', 'Cells', 'Bunk room'] },
  den: { title: 'Den', w: 24, h: 20, front: 0.42, maxRooms: 4, main: 'Front room', others: ['Hideout', 'Storeroom', 'Counting room', 'Bunk room'] },
  warehouse: { title: 'Warehouse', w: 30, h: 22, front: 0.6, maxRooms: 3, main: 'Warehouse floor', others: ['Storeroom', 'Office', 'Bunk room'] },
  stables: { title: 'Stables', w: 28, h: 20, front: 0.6, maxRooms: 3, main: 'Stable', others: ['Tack room', 'Storeroom', 'Bedroom'] },
  cottage: { title: 'Cottage', w: 20, h: 19, front: 0.5, maxRooms: 2, main: 'Main room', others: ['Storeroom', 'Bedroom'] },
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
  chair: false,
  bench: false,
  cabinet: true,
  rug: false,
};

const DIFFICULT: Partial<Record<FurnitureType, boolean>> = {
  table: true,
  bed: true,
  chair: true,
  bench: true,
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

  /** Place one piece if it fits on free floor and keeps the room connected. */
  place(room: Rect, type: FurnitureType, r: Rect, facing?: FurnitureFacing): boolean {
    const m = this.map;
    const doors = this.map.objects.filter((o): o is DoorObject => o.kind === 'door');
    const c = rectCenter(room);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        // Solid pieces never take the room's center: validation and room labels use it.
        if (!rectContains(room, { x, y }) || (SOLID[type] && x === c.x && y === c.y)) return false;
        // Keep an approach square and a turning square clear inside every doorway.
        if (doors.some((door) => {
          const dx = x - door.at.x;
          const dy = y - door.at.y;
          const distance = Math.abs(dx) + Math.abs(dy);
          return distance === 1 || (distance === 2 && (dx === 0 || dy === 0));
        })) return false;
        const i = idx(m, x, y);
        if (m.terrain[i] !== 'floor' || m.flags[i] & 1) return false;
      }
    const before: [number, string, number][] = [];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = idx(m, x, y);
        before.push([i, m.terrain[i], m.flags[i]]);
        if (SOLID[type]) m.terrain[i] = 'furniture';
        else if (DIFFICULT[type]) setDifficult(m, x, y, true);
      }
    if (!this.roomOk(room)) {
      for (const [i, t, f] of before) {
        m.terrain[i] = t as DungeonMap['terrain'][number];
        m.flags[i] = f;
      }
      return false;
    }
    this.objects.push({ id: `furn-${++this.n}`, kind: 'furniture', type, rect: r, facing, visibility: 'public' });
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
      const anchors: Point[] = [];
      for (let ty = y + 2; ty + 2 < y + h - 1; ty += spacingY)
        for (let tx = x + 2; tx + 2 < x + w - 1; tx += spacingX) anchors.push({ x: tx, y: ty });
      for (const p of rng.shuffle(anchors)) {
        if (!this.place(room, 'table', { x: p.x, y: p.y, w: 2, h: 2 })) continue;
        // Seating is placed as a group around the table, leaving natural aisles between groups.
        for (const seat of [
          { x: p.x, y: p.y - 1, facing: 'south' as const },
          { x: p.x + 1, y: p.y - 1, facing: 'south' as const },
          { x: p.x, y: p.y + 2, facing: 'north' as const },
          { x: p.x + 1, y: p.y + 2, facing: 'north' as const },
          { x: p.x - 1, y: p.y, facing: 'east' as const },
          { x: p.x - 1, y: p.y + 1, facing: 'east' as const },
          { x: p.x + 2, y: p.y, facing: 'west' as const },
          { x: p.x + 2, y: p.y + 1, facing: 'west' as const },
        ]) this.place(room, 'chair', { x: seat.x, y: seat.y, w: 1, h: 1 }, seat.facing);
      }
    };
    switch (role) {
      case 'Common room':
      case 'Great hall': {
        if (w >= 8 && h >= 6) this.place(room, 'rug', { x: x + Math.floor(w / 2) - 3, y: y + Math.floor(h / 2) - 2, w: 6, h: 4 });
        if (role === 'Common room') {
          // Put the serving bar against a side wall so the entrance and central aisle stay open.
          this.place(room, 'counter', { x: x + 1, y: y + 2, w: 1, h: Math.min(5, h - 4) });
          this.alongWall(room, 'shelf', Math.max(1, Math.floor(h / 4)));
        }
        if (!this.place(room, 'hearth', { x: x + w - 2, y: y + 1, w: 2, h: 2 })) this.place(room, 'hearth', { x: x + 1, y: y + 1, w: 2, h: 2 });
        tables(5, 5);
        if (role === 'Great hall') this.alongWall(room, 'shelf', 2);
        break;
      }
      case 'Kitchen':
        this.place(room, 'hearth', { x: x + 1, y: y + 1, w: 2, h: 2 });
        this.place(room, 'counter', { x: x + 1, y: y + h - 2, w: Math.max(2, w - 2), h: 1 });
        this.place(room, 'table', { x: x + Math.max(1, Math.floor(w / 2) - 1), y: y + Math.max(2, Math.floor(h / 2)), w: 2, h: 1 });
        this.alongWall(room, 'cabinet', 2);
        this.alongWall(room, 'barrel', 2);
        break;
      case 'Storeroom':
      case 'Pantry': {
        this.alongWall(room, 'barrel', Math.max(2, Math.floor((w + h) / 4)));
        this.alongWall(room, 'shelf', Math.max(1, Math.floor(w / 3)));
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
        if (w >= 6 && h >= 6) this.place(room, 'rug', { x: x + Math.floor(w / 2) - 2, y: y + Math.floor(h / 2) - 1, w: 4, h: 2 });
        for (let b = 0; b < beds; b++) {
          const bx = x + 1 + b * 2;
          if (!this.place(room, 'bed', { x: bx, y: y + 1, w: 1, h: 2 })) this.place(room, 'bed', { x: x + w - 2 - b * 2, y: y + h - 3, w: 1, h: 2 });
          this.place(room, 'cabinet', { x: bx + 1, y: y + 1, w: 1, h: 1 });
        }
        this.place(room, 'chair', { x: x + w - 2, y: y + 1, w: 1, h: 1 });
        this.alongWall(room, 'shelf', 1);
        break;
      }
      case 'Shop floor':
        this.place(room, 'rug', { x: x + 2, y: y + 2, w: Math.max(2, w - 4), h: 2 });
        this.place(room, 'counter', { x: x + Math.max(1, Math.floor(w / 2) - 3), y: y + h - 2, w: Math.min(6, w - 2), h: 1 });
        this.alongWall(room, 'shelf', Math.max(2, Math.floor((w + h) / 3)));
        break;
      case 'Forge':
        if (!this.place(room, 'hearth', { x: x + w - 3, y: y + 1, w: 2, h: 2 })) this.place(room, 'hearth', { x: x + 1, y: y + 1, w: 2, h: 2 });
        this.place(room, 'counter', { x: x + Math.floor(w / 2) - 1, y: y + Math.floor(h / 2), w: 2, h: 1 }); // anvil
        this.place(room, 'cabinet', { x: x + 1, y: y + h - 2, w: 2, h: 1 });
        this.alongWall(room, 'barrel', 2);
        this.alongWall(room, 'shelf', 2);
        break;
      case 'Workshop':
      case 'Tack room':
        this.place(room, 'table', { x: x + 1, y: y + 1, w: 2, h: 1 });
        this.alongWall(room, 'shelf', 3);
        break;
      case 'Nave':
        this.place(room, 'counter', { x: x + Math.floor(w / 2) - 1, y: y + h - 1, w: 3, h: 1 }); // altar at the far end
        for (let ty = y + 2; ty < y + h - 3; ty += 2) {
          // Pews either side of a center aisle
          this.place(room, 'bench', { x: x + 1, y: ty, w: Math.max(1, Math.floor(w / 2) - 2), h: 1 });
          this.place(room, 'bench', { x: x + Math.floor(w / 2) + 2, y: ty, w: Math.max(1, Math.ceil(w / 2) - 3), h: 1 });
        }
        break;
      case 'Vestry':
      case 'Shrine room':
      case 'Office':
      case 'Captain’s office':
      case 'Counting room':
        this.place(room, 'table', { x: x + Math.floor(w / 2) - 1, y: y + 1, w: 2, h: 1 });
        this.alongWall(room, 'shelf', 2);
        break;
      case 'Cell':
      case 'Cells':
        this.place(room, 'bed', { x, y, w: 1, h: 2 });
        if (role === 'Cells') this.place(room, 'bed', { x: x + w - 1, y, w: 1, h: 2 });
        break;
      case 'Bunk room':
        for (let b = 0; b * 2 < w; b++) this.place(room, 'bed', { x: x + b * 2, y, w: 1, h: 2 });
        this.place(room, 'bench', { x: x + 1, y: y + h - 1, w: Math.min(3, w - 2), h: 1 });
        break;
      case 'Armory':
        this.alongWall(room, 'shelf', w + h);
        break;
      case 'Guard room':
      case 'Front room':
      case 'Main room':
        if (role !== 'Guard room') this.place(room, 'hearth', { x: x + w - 1, y: y + Math.floor(h / 2) - 1, w: 1, h: 2 });
        tables(4, 3);
        if (role === 'Guard room') {
          this.alongWall(room, 'shelf', 2);
          this.place(room, 'bench', { x: x + 1, y: y + h - 2, w: Math.min(4, w - 2), h: 1 });
        }
        break;
      case 'Hideout':
        tables(4, 3);
        this.alongWall(room, 'barrel', 3);
        break;
      case 'Warehouse floor':
        this.alongWall(room, 'barrel', w + h);
        for (let ty = y + 2; ty < y + h - 2; ty += 3) for (let tx = x + 2; tx < x + w - 2; tx += 4) this.place(room, 'barrel', { x: tx, y: ty, w: 1, h: 1 });
        break;
      case 'Stable':
        for (let sx = x; sx + 1 < x + w; sx += 3) this.place(room, 'stall', { x: sx, y: y + h - 1, w: 2, h: 1 });
        this.alongWall(room, 'barrel', 2);
        break;
      case 'Study':
      case 'Library':
        this.alongWall(room, 'shelf', role === 'Library' ? w + h : 3);
        this.place(room, 'table', { x: x + Math.floor(w / 2) - 1, y: y + 1, w: 2, h: 1 });
        break;
      case 'Chapel':
        this.place(room, 'counter', { x: x + Math.floor(w / 2) - 1, y, w: 2, h: 1 }); // altar
        for (let ty = y + 2; ty < y + h - 1; ty += 2) this.place(room, 'bench', { x: x + 1, y: ty, w: Math.max(1, w - 2), h: 1 }); // pews
        break;
      default:
        tables(4, 3);
    }
    return null;
  }
}

export function generateInterior(seed: string, kind: InteriorKind): GenerateResult {
  const rng = createRng(`interior:${INTERIOR_VERSION}:${kind}:${seed}`);
  const plan = PLANS[kind];
  const W = plan.w;
  const H = plan.h;
  const map = createEmptyMap({ id: `map-small-${kind}-${seed}`, title: `${plan.title} ${seed}`, width: W, height: H, fill: 'ground' });
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
  const mainH = Math.max(MIN_ROOM + 1, Math.round(inner.h * plan.front));
  const main: Rect = { x: inner.x, y: inner.y, w: inner.w, h: mainH };
  const frontSplit: Split = { vertical: false, line: inner.y + mainH, from: inner.x, to: inner.x + inner.w - 1 };
  splits.push(frontSplit);
  const back: Rect = { x: inner.x, y: inner.y + mainH + 1, w: inner.w, h: inner.h - mainH - 1 };
  const maxRooms = plan.maxRooms;
  const guidedInn = (kind === 'tavern' || kind === 'inn') && back.h >= 7 && inner.w >= 18;
  const mainToHallX = inner.x + Math.floor(inner.w / 2);
  /**
   * A row of rooms across [x0, x1), each at least MIN_ROOM wide, divided by
   * walls with no doors; each room gets one door in `doorLine` (a hall wall).
   */
  const roomRow = (x0: number, x1: number, y: number, h: number, doorLine: number, limit: number) => {
    const total = x1 - x0;
    const n = Math.max(1, Math.min(limit, Math.floor((total + 1) / (MIN_ROOM + 1))));
    if (limit <= 0 || total < MIN_ROOM) return;
    const floorW = total - (n - 1);
    const base = Math.floor(floorW / n);
    const extra = floorW - base * n;
    let x = x0;
    for (let i = 0; i < n; i++) {
      const w = base + (i < extra ? 1 : 0);
      leaves.push({ x, y, w, h });
      splits.push({ vertical: false, line: doorLine, from: x, to: x + w - 1 });
      // Dividers run into the hall wall too, so it has no gaps where they meet.
      if (i < n - 1) splits.push({ vertical: true, line: x + w, from: Math.min(y, doorLine), to: Math.max(y + h - 1, doorLine), door: false });
      x += w + 1;
    }
  };
  const roomBudget = () => Math.min(maxRooms - 1, plan.others.length) - leaves.length;
  if (guidedInn) {
    // The common room opens onto a rear hall, and every other room has its
    // own door off the hall. Inns with room for it get rooms on both sides.
    const doubleLoaded = back.h >= 2 * MIN_ROOM + 4;
    if (doubleLoaded) {
      // [rooms A] wall [hall ×2] wall [rooms B]; a passage from the common room
      // runs between the A rooms to the hall.
      const hA = Math.floor((back.h - 4) / 2);
      const wallA = back.y + hA;
      const hallY = wallA + 1;
      const wallB = hallY + 2;
      const yB = wallB + 1;
      const hB = back.y + back.h - yB;
      const px = mainToHallX;
      splits.push({ vertical: true, line: px - 1, from: back.y, to: wallA, door: false });
      splits.push({ vertical: true, line: px + 1, from: back.y, to: wallA, door: false });
      roomRow(inner.x, inner.x + inner.w, yB, hB, wallB, roomBudget());
      const half = roomBudget();
      roomRow(inner.x, px - 1, back.y, hA, wallA, Math.ceil(half / 2));
      roomRow(px + 2, inner.x + inner.w, back.y, hA, wallA, roomBudget());
    } else {
      const hallY = back.y;
      const wall = hallY + 2;
      roomRow(inner.x, inner.x + inner.w, wall + 1, inner.y + inner.h - wall - 1, wall, roomBudget());
    }
  } else if (back.h >= 2) {
    bsp(rng, back, 0, (r, d) => r.w * r.h <= (kind === 'cottage' ? 60 : 30) || (d >= 2 && rng.chance(0.35)) || leaves.length >= maxRooms - 1, leaves, splits);
  }
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
    if (s.door === false) continue;
    const options: Point[] = [];
    for (let k = s.from; k <= s.to; k++) {
      const p = s.vertical ? { x: s.line, y: k } : { x: k, y: s.line };
      const a = s.vertical ? map.terrain[idx(map, p.x - 1, p.y)] : map.terrain[idx(map, p.x, p.y - 1)];
      const b = s.vertical ? map.terrain[idx(map, p.x + 1, p.y)] : map.terrain[idx(map, p.x, p.y + 1)];
      if (a === 'floor' && b === 'floor') options.push(p);
    }
    if (!options.length) continue;
    const preferred = s === frontSplit ? options.find((p) => p.x === mainToHallX) : undefined;
    const p = preferred ?? rng.pick(options);
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
  const yardFeatures = kind === 'manor' ? 40 : kind === 'cottage' ? 24 : 10;
  for (let k = 0; k < yardFeatures; k++) {
    const x = rng.int(0, W - 1),
      y = rng.int(3, H - 1);
    const i = idx(map, x, y);
    if (map.terrain[i] !== 'ground' || Math.abs(x - fx) <= 1) continue;
    const nearWall = ORTHOGONAL.some((d) => map.terrain[idx(map, x + d.x, y + d.y)] === 'wall');
    if (!nearWall) map.terrain[i] = rng.chance(0.4) ? 'tree' : 'brush';
  }

  // Roles and furniture
  const roles = plan;
  const rooms: { rect: Rect; role: string }[] = [{ rect: main, role: roles.main }];
  const sorted = [...leaves].sort((a, b) => b.w * b.h - a.w * a.h);
  sorted.forEach((r, i) => rooms.push({ rect: r, role: roles.others[i % roles.others.length] }));
  // The storeroom (with the cellar stairs) should be the room farthest from the front door.
  const far = rooms.slice(1).reduce((best, r) => (rectCenter(r.rect).y > rectCenter(best.rect).y ? r : best), rooms[1] ?? rooms[0]);
  const storeIdx = rooms.findIndex((r) => r.role === 'Storeroom');
  if (!guidedInn && far && storeIdx > 0 && far !== rooms[storeIdx]) [far.role, rooms[storeIdx].role] = [rooms[storeIdx].role, far.role];

  // Furniture placement checks these so every room entrance keeps a clear approach.
  map.objects = [...doors];
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
