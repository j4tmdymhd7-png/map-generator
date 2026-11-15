import { describe, expect, it } from 'vitest';
import { rectCenter } from '../model/grid';
import { isStandable } from '../model/terrain';
import type { RoomObject } from '../model/types';
import { buildMoveGrid } from '../rules/dnd2024';
import { computeReach, costTo } from '../rules/pathfinding';
import { token } from '../rules/test-helpers';
import { startPoint } from '../encounter/placement';
import { generateMap, MAP_SIZES, SIZE_INFO } from './maps';

const combos = MAP_SIZES.flatMap((size) => SIZE_INFO[size].kinds.map((k) => [size, k.kind] as const));

describe('every map size and type', () => {
  for (const [size, kind] of combos) {
    it(`${size} ${kind}: valid, deterministic, and every place reachable on foot from the start`, () => {
      for (const seed of ['alpha', 'bravo', 'charlie']) {
        const a = generateMap(seed, size, kind);
        expect(a.issues.filter((i) => i.severity === 'error'), `${size} ${kind} ${seed}`).toEqual([]);
        expect(JSON.stringify(generateMap(seed, size, kind).map.terrain)).toBe(JSON.stringify(a.map.terrain));
        const map = a.map;
        const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
        expect(rooms.length).toBeGreaterThan(size === 'small' ? 2 : 5);
        const start = startPoint(map);
        expect(isStandable(map.terrain[start.y * map.width + start.x]) || map.terrain[start.y * map.width + start.x] === 'stairs').toBe(true);
        const mover = token({ mapId: map.id, position: start });
        const reach = computeReach(buildMoveGrid(map, mover, [mover], { diagonal: 'uniform', closedDoors: 'passable' }), start, 1);
        for (const r of rooms) expect(costTo(reach, rectCenter(r.rect)), `${size} ${kind} ${seed} ${r.label}`).toBeLessThan(Infinity);
      }
    });
  }

  it('maps are the advertised sizes', () => {
    expect(generateMap('x', 'medium', 'dungeon').map.width).toBe(40);
    expect(generateMap('x', 'large', 'cave').map.width).toBe(80);
    expect(generateMap('x', 'huge', 'town').map.width).toBe(120);
    expect(generateMap('x', 'gargantuan', 'city').map.width).toBe(200);
    expect(generateMap('x', 'small', 'tavern').map.width).toBeLessThan(40);
  });

  it('different sizes of the same seed get different map ids', () => {
    expect(generateMap('x', 'medium', 'dungeon').map.id).not.toBe(generateMap('x', 'large', 'dungeon').map.id);
  });
});
