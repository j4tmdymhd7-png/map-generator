import { describe, expect, it } from 'vitest';
import { idx, rectCenter } from '../model/grid';
import { parseCampaign } from '../model/schema';
import { SCHEMA_VERSION, type FurnitureObject, type RoomObject } from '../model/types';
import { generateInterior, type InteriorKind } from './interior';

const KINDS: InteriorKind[] = ['tavern', 'inn', 'manor', 'shop', 'smithy', 'temple', 'barracks', 'den', 'warehouse', 'stables', 'cottage'];
const rooms = (m: ReturnType<typeof generateInterior>['map']) => m.objects.filter((o): o is RoomObject => o.kind === 'room');
const furniture = (m: ReturnType<typeof generateInterior>['map']) => m.objects.filter((o): o is FurnitureObject => o.kind === 'furniture');

describe('interior layouts', () => {
  it('every room is reachable across many seeds (solid furniture never takes a room center)', () => {
    for (const kind of KINDS)
      for (let s = 0; s < 60; s++) {
        const { map, issues } = generateInterior(`many-${s}`, kind);
        expect(issues.filter((i) => i.severity === 'error'), `${kind} many-${s}`).toEqual([]);
        for (const r of rooms(map)) {
          const c = rectCenter(r.rect);
          expect(map.terrain[idx(map, c.x, c.y)], `${kind} many-${s} ${r.label} center`).not.toBe('furniture');
        }
      }
  });

  it('room bounds never include walls, and hall walls have no gaps', () => {
    for (const kind of KINDS)
      for (let s = 0; s < 30; s++) {
        const { map } = generateInterior(`walls-${s}`, kind);
        const rs = rooms(map);
        for (const r of rs)
          for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++)
            for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) expect(map.terrain[idx(map, x, y)], `${kind} ${r.label} at ${x},${y}`).not.toBe('wall');
        // A floor square walled on three sides, outside every room, is a notch in a wall.
        for (let y = 1; y < map.height - 1; y++)
          for (let x = 1; x < map.width - 1; x++) {
            if (map.terrain[idx(map, x, y)] !== 'floor') continue;
            const walls = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].filter(([dx, dy]) => map.terrain[idx(map, x + dx, y + dy)] === 'wall').length;
            const inRoom = rs.some((r) => x >= r.rect.x && y >= r.rect.y && x < r.rect.x + r.rect.w && y < r.rect.y + r.rect.h);
            expect(walls >= 3 && !inRoom, `${kind} notch at ${x},${y}`).toBe(false);
          }
      }
  });

  it('inns have rooms on both sides of the hall: at least five guest or private rooms', () => {
    for (let s = 0; s < 20; s++) {
      const rs = rooms(generateInterior(`inn-${s}`, 'inn').map);
      expect(rs.filter((r) => /Guest room|Private room/.test(r.label ?? '')).length, `inn-${s}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('common rooms get tables with chairs around them, facing in', () => {
    const f = furniture(generateInterior('chairs', 'tavern').map);
    expect(f.filter((p) => p.type === 'table' && p.rect.w === 2 && p.rect.h === 2).length).toBeGreaterThan(0);
    const chairs = f.filter((p) => p.type === 'chair');
    expect(chairs.length).toBeGreaterThan(4);
    expect(chairs.every((c) => c.facing)).toBe(true);
  });

  it('temples have pews (benches)', () => {
    expect(furniture(generateInterior('pews', 'temple').map).some((p) => p.type === 'bench')).toBe(true);
  });

  it('chair facing survives saving and loading', () => {
    const { map } = generateInterior('save', 'tavern');
    const before = furniture(map).filter((p) => p.facing).length;
    const res = parseCampaign(
      JSON.parse(
        JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          id: 'c',
          name: 'c',
          ruleset: { edition: 'dnd-2024', version: 'srd-5.2.1' },
          maps: [map],
          tokens: [],
          settings: { grid: { diagonal: 'uniform', closedDoors: 'block' } },
        }),
      ),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.campaign.maps[0].objects.filter((o) => o.kind === 'furniture' && o.facing).length).toBe(before);
    expect(before).toBeGreaterThan(0);
  });
});
