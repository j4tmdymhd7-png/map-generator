import { describe, expect, it } from 'vitest';
import { OUTDOOR_COLORS as C } from './ink';

// WCAG relative luminance contrast between two #rrggbb colors.
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

describe('Color map style', () => {
  it.each([
    ['ground', C.ground, 'shallow water', C.shallowWater],
    ['shallow water', C.shallowWater, 'deep water', C.deepWater],
    ['ground', C.ground, 'trail', C.trail],
    ['town ground', C.townGround, 'street', C.street],
    ['street', C.street, 'roof', C.roof],
  ])('%s and %s differ in brightness, not only hue', (_a, a, _b, b) => {
    expect(contrast(a, b)).toBeGreaterThanOrEqual(1.4);
  });
});
