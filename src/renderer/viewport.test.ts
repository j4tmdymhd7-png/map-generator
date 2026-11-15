import { describe, expect, it } from 'vitest';
import { cacheCellSize, fitViewport, screenToCell, zoomAt } from './viewport';

describe('viewport math', () => {
  it('fits and centers a map', () => {
    const v = fitViewport(40, 20, 1000, 600, 0);
    expect(v.zoom).toBe(25);
    expect(v.x).toBe(0);
    expect(v.y).toBe(50);
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const v = { zoom: 20, x: 10, y: 10 };
    const before = screenToCell(v, 210, 110);
    const z = zoomAt(v, 2, 210, 110);
    expect(z.zoom).toBe(40);
    expect(screenToCell(z, 210, 110)).toEqual(before);
  });

  it('snaps cache resolution to powers of two and caps memory', () => {
    expect(cacheCellSize(20, 2, 40, 40)).toBe(64);
    expect(cacheCellSize(150, 2, 100, 100)).toBe(32); // capped: sqrt(16M / 10k) = 40 -> 32
    expect(cacheCellSize(150, 2, 100, 100)).toBeLessThanOrEqual(40);
  });
});
