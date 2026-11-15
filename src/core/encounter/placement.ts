import { idx, ORTHOGONAL, rectCenter } from '../model/grid';
import type { DungeonMap, Point, RoomObject, Size, Token } from '../model/types';
import { footprintSquares } from '../rules/dnd2024';

const STANDABLE = new Set(['floor', 'stairs']);

function footprintFree(map: DungeonMap, x: number, y: number, s: number, taken: Set<number>): boolean {
  for (let dy = 0; dy < s; dy++)
    for (let dx = 0; dx < s; dx++) {
      const cx = x + dx,
        cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return false;
      const i = idx(map, cx, cy);
      if (!STANDABLE.has(map.terrain[i]) || taken.has(i)) return false;
    }
  return true;
}

/** Squares already covered by tokens on this map. */
export function occupiedSquares(map: DungeonMap, tokens: Token[]): Set<number> {
  const taken = new Set<number>();
  for (const t of tokens) {
    if (t.mapId !== map.id) continue;
    const s = footprintSquares(t.size);
    for (let dy = 0; dy < s; dy++)
      for (let dx = 0; dx < s; dx++) taken.add(idx(map, t.position.x + dx, t.position.y + dy));
  }
  return taken;
}

/**
 * Find a free spot for a creature of `size` as close as possible (by walking
 * distance over floor) to `near`. Returns null if nothing fits.
 */
export function findFreeSpot(map: DungeonMap, near: Point, size: Size, taken: Set<number>): Point | null {
  const s = footprintSquares(size);
  const seen = new Uint8Array(map.width * map.height);
  const queue: Point[] = [near];
  seen[idx(map, near.x, near.y)] = 1;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    // Skip the stairs square itself so nobody spawns standing on the stairs symbol.
    if (map.terrain[idx(map, p.x, p.y)] !== 'stairs' && footprintFree(map, p.x, p.y, s, taken)) return p;
    for (const d of ORTHOGONAL) {
      const nx = p.x + d.x,
        ny = p.y + d.y;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const i = idx(map, nx, ny);
      const t = map.terrain[i];
      if (seen[i] || !(STANDABLE.has(t) || t === 'door')) continue;
      seen[i] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** Where the party starts: the entrance stairs, else the first room's center. */
export function startPoint(map: DungeonMap): Point {
  const entrance = map.objects.find((o) => o.kind === 'stairs' && o.role === 'entrance');
  if (entrance && entrance.kind === 'stairs') return entrance.at;
  const room = map.objects.find((o): o is RoomObject => o.kind === 'room');
  return room ? rectCenter(room.rect) : { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
}

/** Place each token (in order) at the nearest free spot to `near`. Tokens that don't fit keep their position. */
export function placeGroup(map: DungeonMap, tokens: Token[], near: Point, others: Token[] = []): Token[] {
  const taken = occupiedSquares(map, others);
  return tokens.map((t) => {
    const spot = findFreeSpot(map, near, t.size, taken);
    if (!spot) return t;
    const placed = { ...t, mapId: map.id, position: spot };
    for (const i of occupiedSquares(map, [placed])) taken.add(i);
    return placed;
  });
}
