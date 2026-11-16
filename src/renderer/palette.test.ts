import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
  const src = readFileSync(new URL('./ink.ts', import.meta.url), 'utf8');
  const pick = (re: RegExp) => {
    const m = src.match(re);
    if (!m) throw new Error(`color not found: ${re}`);
    return m[1];
  };
  const ground = pick(/isUrban\(map\) \? '#c0b59a' : '(#[0-9a-f]{6})'/);
  const townGround = '#c0b59a';
  const shallow = pick(/ctx\.fillStyle = '(#[0-9a-f]{6})'; fillMapPath\(ctx, water/);
  const deep = pick(/ctx\.fillStyle = '(#[0-9a-f]{6})'; fillMapPath\(ctx, deepwater/);
  const trail = pick(/STREET : '(#[0-9a-f]{6})'/);
  const street = pick(/const STREET = '(#[0-9a-f]{6})'/);
  const roof = pick(/const ROOF_TILE = '(#[0-9a-f]{6})'/);

  it.each([
    ['ground', ground, 'shallow water', shallow],
    ['shallow water', shallow, 'deep water', deep],
    ['ground', ground, 'trail', trail],
    ['town ground', townGround, 'street', street],
    ['street', street, 'roof', roof],
  ])('%s and %s differ in brightness, not only hue', (_a, a, _b, b) => {
    expect(contrast(a, b)).toBeGreaterThanOrEqual(1.4);
  });
});
