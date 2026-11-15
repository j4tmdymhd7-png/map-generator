import { describe, expect, it } from 'vitest';
import { asciiMap } from '../rules/test-helpers';
import { computeVisible, FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE, updateFog } from './fog';

const at = (map: { width: number }, vis: Uint8Array, x: number, y: number) => vis[y * map.width + x];

describe('fog of war', () => {
  it('sees across an open room and its walls, not through them', () => {
    const map = asciiMap(['#######', '#.....#', '#.....#', '#######', '#.....#', '#######']);
    const vis = computeVisible(map, [{ x: 1, y: 1, size: 1 }], 10);
    expect(at(map, vis, 5, 2)).toBe(1);
    expect(at(map, vis, 6, 2)).toBe(1); // the far wall is visible
    expect(at(map, vis, 3, 4)).toBe(0); // the room beyond the wall isn't
  });

  it('closed doors block sight; open doors do not', () => {
    const closed = asciiMap(['#####', '#...#', '##+##', '#...#', '#####']);
    const open = asciiMap(['#####', '#...#', '##/##', '#...#', '#####']);
    expect(at(closed, computeVisible(closed, [{ x: 2, y: 1, size: 1 }], 10), 2, 3)).toBe(0);
    expect(at(open, computeVisible(open, [{ x: 2, y: 1, size: 1 }], 10), 2, 3)).toBe(1);
  });

  it('pillars cast a shadow', () => {
    const map = asciiMap(['#######', '#.X...#', '#######']);
    const vis = computeVisible(map, [{ x: 1, y: 1, size: 1 }], 10);
    expect(at(map, vis, 2, 1)).toBe(1); // you see the pillar itself
    expect(at(map, vis, 4, 1)).toBe(0); // but not behind it
  });

  it("can't peek diagonally between walls that touch at a corner", () => {
    const map = asciiMap(['.#', '#.']);
    expect(at(map, computeVisible(map, [{ x: 0, y: 0, size: 1 }], 5), 1, 1)).toBe(0);
  });

  it('respects the sight radius', () => {
    const map = asciiMap(['..........']);
    const vis = computeVisible(map, [{ x: 0, y: 0, size: 1 }], 4);
    expect(at(map, vis, 4, 0)).toBe(1);
    expect(at(map, vis, 6, 0)).toBe(0);
  });

  it('remembers explored squares', () => {
    const first = updateFog(null, Uint8Array.from([1, 1, 0]));
    const second = updateFog(first, Uint8Array.from([0, 1, 1]));
    expect([...second]).toEqual([FOG_EXPLORED, FOG_VISIBLE, FOG_VISIBLE]);
    expect([...updateFog(null, Uint8Array.from([0, 0, 0]))]).toEqual([FOG_HIDDEN, FOG_HIDDEN, FOG_HIDDEN]);
  });
});
