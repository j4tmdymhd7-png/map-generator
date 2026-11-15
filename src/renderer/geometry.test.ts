import { describe, expect, it } from 'vitest';
import { asciiMap } from '../core/rules/test-helpers';
import { doorOrientation, rockDistance, wallSegments } from './geometry';

describe('ink geometry', () => {
  it('outlines a room with four merged wall strokes', () => {
    const map = asciiMap(['#####', '#...#', '#...#', '#####']);
    const segs = wallSegments(map);
    expect(segs).toHaveLength(4);
    expect(segs).toContainEqual({ x1: 1, y1: 1, x2: 4, y2: 1 });
    expect(segs).toContainEqual({ x1: 1, y1: 3, x2: 4, y2: 3 });
    expect(segs).toContainEqual({ x1: 1, y1: 1, x2: 1, y2: 3 });
    expect(segs).toContainEqual({ x1: 4, y1: 1, x2: 4, y2: 3 });
  });

  it('leaves a gap in the wall where a door opens into a corridor', () => {
    const map = asciiMap(['#####', '#...#', '##+##', ' #.# ']);
    const top = wallSegments(map).filter((s) => s.y1 === 2 && s.y2 === 2);
    expect(top).toEqual([
      { x1: 1, y1: 2, x2: 2, y2: 2 },
      { x1: 3, y1: 2, x2: 4, y2: 2 },
    ]);
  });

  it('orients doors along the wall they sit in', () => {
    const map = asciiMap(['#####', '#...#', '##+##', ' #.# ', '##.##', '.+...', '##.##']);
    expect(doorOrientation(map, 2, 2)).toBe('horizontal');
    expect(doorOrientation(asciiMap(['###', '.+.', '###']), 1, 1)).toBe('vertical');
  });

  it('measures how far rock is from open floor', () => {
    const map = asciiMap(['     ', ' ... ', '     ', '     ']);
    const d = rockDistance(map, 2);
    expect(d[1 * 5 + 2]).toBe(0);
    expect(d[0]).toBe(1);
    expect(d[3 * 5 + 2]).toBe(2);
  });
});
