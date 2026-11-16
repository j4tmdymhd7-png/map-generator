import { describe, expect, it } from 'vitest';
import { idx, ORTHOGONAL } from '../model/grid';
import { asciiMap } from '../rules/test-helpers';
import { wallSegments } from '../../renderer/geometry';
import { wallCorners } from '../../renderer/ink';
import { generateDungeon } from './generate';

describe('dungeon generator v3', () => {
  it('every floor square in caves is reachable on foot (no corner-only pockets)', () => {
    for (const big of [false, true])
      for (let s = 0; s < 60; s++) {
        const { map } = generateDungeon(`cave-${s}`, big ? { theme: 'cave', width: 80, height: 80, rooms: { min: 18, max: 28 }, roomSize: { min: 4, max: 12 } } : { theme: 'cave' });
        const start = map.objects.find((o) => o.kind === 'stairs');
        if (!start || start.kind !== 'stairs') continue;
        const seen = new Set([idx(map, start.at.x, start.at.y)]);
        const queue = [idx(map, start.at.x, start.at.y)];
        while (queue.length) {
          const i = queue.pop()!;
          const x = i % map.width,
            y = (i - x) / map.width;
          for (const d of ORTHOGONAL) {
            const ni = idx(map, x + d.x, y + d.y);
            const t = map.terrain[ni];
            if (!seen.has(ni) && t !== 'void' && t !== 'wall' && t !== 'obstacle' && t !== 'pit') {
              seen.add(ni);
              queue.push(ni);
            }
          }
        }
        const stranded = map.terrain.filter((t, i) => t === 'floor' && !seen.has(i)).length;
        expect(stranded, `cave-${s}${big ? ' (large)' : ''}`).toBe(0);
      }
  });

  it('is deterministic per seed', () => {
    expect(generateDungeon('same', { theme: 'cave' }).map.terrain).toEqual(generateDungeon('same', { theme: 'cave' }).map.terrain);
  });
});

describe('wall corners', () => {
  it('a plain room has four rounded corners', () => {
    const map = asciiMap(['#####', '#...#', '#...#', '#####']);
    expect(wallCorners(wallSegments(map))).toHaveLength(4);
  });
});
