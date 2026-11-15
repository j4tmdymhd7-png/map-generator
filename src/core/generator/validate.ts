import { idx, inBounds, ORTHOGONAL, rectCenter, rectsOverlap, terrainAt } from '../model/grid';
import type { DungeonMap, RoomObject } from '../model/types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

const WALKABLE = new Set(['floor', 'door', 'stairs', 'pit', 'hazard']);

/**
 * Structural checks for any map (generated or hand-drawn). Doors count as
 * walkable here: connectivity means "reachable once doors are opened".
 */
export function validateDungeon(map: DungeonMap): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');

  for (const r of rooms) {
    const { x, y, w, h } = r.rect;
    if (x < 0 || y < 0 || x + w > map.width || y + h > map.height)
      issues.push({ severity: 'error', message: `${r.label ?? r.id} extends outside the map.` });
  }
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      if (rectsOverlap(rooms[i].rect, rooms[j].rect))
        issues.push({ severity: 'error', message: `${rooms[i].label ?? rooms[i].id} overlaps ${rooms[j].label ?? rooms[j].id}.` });

  for (const o of map.objects) {
    if (o.kind === 'door' && terrainAt(map, o.at.x, o.at.y) !== 'door')
      issues.push({ severity: 'warning', message: `Door ${o.id} is not on a door square.` });
  }

  if (rooms.length > 1) {
    const seen = new Uint8Array(map.width * map.height);
    // Room centers are always open floor (generator guarantees it; shaped rooms may not fill their corners).
    const start = rectCenter(rooms[0].rect);
    const queue: number[] = [idx(map, start.x, start.y)];
    seen[queue[0]] = 1;
    while (queue.length) {
      const c = queue.pop()!;
      const x = c % map.width,
        y = (c - x) / map.width;
      for (const d of ORTHOGONAL) {
        const nx = x + d.x,
          ny = y + d.y;
        if (!inBounds(map, nx, ny)) continue;
        const ni = idx(map, nx, ny);
        if (seen[ni] || !WALKABLE.has(map.terrain[ni])) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    for (const r of rooms.slice(1))
      if (!seen[idx(map, rectCenter(r.rect).x, rectCenter(r.rect).y)])
        issues.push({ severity: 'error', message: `${r.label ?? r.id} can't be reached from ${rooms[0].label ?? rooms[0].id}.` });
  }
  return issues;
}
