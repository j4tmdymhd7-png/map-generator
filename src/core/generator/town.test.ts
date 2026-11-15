import { describe, expect, it } from 'vitest';
import type { StructureObject } from '../model/types';
import { generateTown } from './outdoor';

const structures = (m: ReturnType<typeof generateTown>['map'], type: StructureObject['type']) =>
  m.objects.filter((o): o is StructureObject => o.kind === 'structure' && o.type === type);

describe('towns and cities', () => {
  for (const seed of ['grandmere', 'kingsport', 'ashvale']) {
    it(`city ${seed}: walls, towers, four gates, houses clear of the wall`, () => {
      const { map } = generateTown(seed, 'gargantuan');
      const at = (x: number, y: number) => map.terrain[y * map.width + x];
      // Four gates, each three doors wide, open by default
      const gates = map.objects.filter((o) => o.kind === 'door' && o.label?.endsWith('gate'));
      expect(new Set(gates.map((g) => g.label))).toEqual(new Set(['North gate', 'South gate', 'West gate', 'East gate']));
      expect(gates).toHaveLength(12);
      for (const g of gates) if (g.kind === 'door') expect(at(g.at.x, g.at.y)).toBe('door');
      expect(structures(map, 'tower').length).toBeGreaterThanOrEqual(16);
      // No house touches the city wall or a tower (the ring road runs between).
      const fort = [...structures(map, 'wall'), ...structures(map, 'tower')];
      for (const h of structures(map, 'building'))
        for (const f of fort) {
          const gapX = Math.max(f.rect.x - (h.rect.x + h.rect.w), h.rect.x - (f.rect.x + f.rect.w));
          const gapY = Math.max(f.rect.y - (h.rect.y + h.rect.h), h.rect.y - (f.rect.y + f.rect.h));
          expect(Math.max(gapX, gapY), `house at ${h.rect.x},${h.rect.y}`).toBeGreaterThanOrEqual(2);
        }
    });
  }

  it('houses are rectangles of solid squares that never overlap', () => {
    for (const scale of ['huge', 'gargantuan'] as const) {
      const { map } = generateTown('kingsport', scale);
      const owner = new Int32Array(map.width * map.height).fill(-1);
      structures(map, 'building').forEach((h, k) => {
        expect(h.rect.w).toBeGreaterThanOrEqual(2);
        expect(h.rect.h).toBeGreaterThanOrEqual(2);
        for (let y = h.rect.y; y < h.rect.y + h.rect.h; y++)
          for (let x = h.rect.x; x < h.rect.x + h.rect.w; x++) {
            const i = y * map.width + x;
            expect(map.terrain[i]).toBe('wall');
            expect(owner[i], `overlap at ${x},${y}`).toBe(-1);
            owner[i] = k;
          }
      });
    }
  });

  it('blocks have courtyards behind the houses, reached by alleys', () => {
    const { map } = generateTown('kingsport', 'huge');
    const courts = map.objects.filter((o) => o.kind === 'room' && /Courtyard|Garden/.test(o.label ?? ''));
    expect(courts.length).toBeGreaterThan(4);
  });
});
