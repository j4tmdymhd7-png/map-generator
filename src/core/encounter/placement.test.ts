import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../generator/generate';
import { asciiMap, token } from '../rules/test-helpers';
import { findFreeSpot, occupiedSquares, placeGroup, startPoint } from './placement';

describe('token placement', () => {
  it('places a group on distinct floor squares near the entrance', () => {
    const { map } = generateDungeon('goblin-warren');
    const party = [1, 2, 3, 4].map(() => token({ mapId: map.id }));
    const placed = placeGroup(map, party, startPoint(map));
    const squares = placed.map((t) => `${t.position.x},${t.position.y}`);
    expect(new Set(squares).size).toBe(4);
    for (const t of placed) expect(map.terrain[t.position.y * map.width + t.position.x]).toBe('floor');
  });

  it('fits a Large creature only where 2x2 floor is free', () => {
    const map = asciiMap(['#####', '#.#..', '#....', '#####']);
    const spot = findFreeSpot(map, { x: 1, y: 1 }, 'large', new Set());
    expect(spot).toEqual({ x: 3, y: 1 }); // (1,1) and (2,1) cannot hold a 2x2 footprint
  });

  it('avoids squares other tokens occupy', () => {
    const map = asciiMap(['....']);
    const other = token({ mapId: map.id, position: { x: 0, y: 0 } });
    const taken = occupiedSquares(map, [other]);
    expect(findFreeSpot(map, { x: 0, y: 0 }, 'medium', taken)).toEqual({ x: 1, y: 0 });
  });
});
