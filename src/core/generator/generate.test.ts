import { describe, expect, it } from 'vitest';
import { terrainAt } from '../model/grid';
import { parseCampaign } from '../model/schema';
import { SCHEMA_VERSION, type Campaign, type RoomObject } from '../model/types';
import { generateDungeon, GENERATOR_VERSION } from './generate';
import { validateDungeon } from './validate';
import { rectCenter } from '../model/grid';
import { buildMoveGrid } from '../rules/dnd2024';
import { computeReach, costTo } from '../rules/pathfinding';
import { token } from '../rules/test-helpers';

const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);

describe('dungeon generator', () => {
  it('is deterministic for the same seed and params', () => {
    const a = generateDungeon('goblin-warren');
    const b = generateDungeon('goblin-warren');
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
    expect(a.map.generation).toMatchObject({ seed: 'goblin-warren', generatorVersion: GENERATOR_VERSION });
  });

  it('produces different layouts for different seeds', () => {
    expect(JSON.stringify(generateDungeon('a').map.terrain)).not.toBe(JSON.stringify(generateDungeon('b').map.terrain));
  });

  it('holds its invariants across many seeds (40x40, 8-12 rooms)', () => {
    for (const s of seeds) {
      const { map, issues } = generateDungeon(s);
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors, `seed ${s}`).toEqual([]);
      const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
      expect(rooms.length, `seed ${s}`).toBeGreaterThanOrEqual(8);
      expect(rooms.length, `seed ${s}`).toBeLessThanOrEqual(12);
      // Map edge is never walkable
      for (let x = 0; x < map.width; x++) {
        expect(['void', 'wall']).toContain(terrainAt(map, x, 0));
        expect(['void', 'wall']).toContain(terrainAt(map, x, map.height - 1));
      }
    }
  });

  it('places entrance and exit stairs', () => {
    const { map } = generateDungeon('stairs-check');
    const stairs = map.objects.filter((o) => o.kind === 'stairs');
    expect(stairs.map((s) => (s.kind === 'stairs' ? s.role : null)).sort()).toEqual(['entrance', 'exit']);
  });

  it('every door object sits on a door square between two walls', () => {
    for (const s of seeds.slice(0, 50)) {
      const { map } = generateDungeon(s);
      for (const o of map.objects) {
        if (o.kind !== 'door') continue;
        expect(terrainAt(map, o.at.x, o.at.y)).toBe('door');
      }
    }
  });

  it('warns instead of failing when rooms cannot fit', () => {
    const { issues } = generateDungeon('tiny', { width: 12, height: 12, rooms: { min: 8, max: 8 } });
    expect(issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags a disconnected hand-made map', () => {
    const { map } = generateDungeon('cut-me');
    const room = map.objects.find((o): o is RoomObject => o.kind === 'room' && o.label === 'Room 2')!;
    // Wall off room 2 entirely
    const { x, y, w, h } = room.rect;
    for (let yy = y - 1; yy <= y + h; yy++)
      for (let xx = x - 1; xx <= x + w; xx++) {
        const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
        if (!inside) map.terrain[yy * map.width + xx] = 'wall';
      }
    expect(validateDungeon(map).some((i) => i.message.includes("can't be reached"))).toBe(true);
  });
});

describe('generator v2 variety', () => {
  for (const theme of ['dungeon', 'cave'] as const) {
    it(`a Medium creature can walk from the entrance to every room (${theme})`, () => {
      for (const s of seeds.slice(0, 80)) {
        const { map, issues } = generateDungeon(s, { theme });
        expect(issues.filter((i) => i.severity === 'error'), `${theme} ${s}`).toEqual([]);
        const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
        const start = rectCenter(rooms[0].rect);
        const mover = token({ mapId: map.id, position: start });
        const grid = buildMoveGrid(map, mover, [mover], { diagonal: 'uniform', closedDoors: 'passable' });
        const reach = computeReach(grid, start, 1);
        for (const r of rooms) expect(costTo(reach, rectCenter(r.rect)), `${theme} ${s} ${r.label}`).toBeLessThan(Infinity);
      }
    });
  }

  it('produces a mix of room shapes and furnishings', () => {
    const shapes = new Set<string>();
    let pillars = 0,
      pits = 0,
      rubble = 0;
    for (const s of seeds.slice(0, 40)) {
      const { map } = generateDungeon(s);
      for (const o of map.objects) if (o.kind === 'room') shapes.add(o.shape ?? 'rect');
      map.terrain.forEach((t, i) => {
        if (t === 'obstacle') pillars++;
        if (t === 'pit') pits++;
        if (map.flags[i] & 1) rubble++;
      });
    }
    expect([...shapes].sort()).toEqual(['cave', 'cross', 'rect', 'round']);
    expect(pillars).toBeGreaterThan(0);
    expect(pits).toBeGreaterThan(0);
    expect(rubble).toBeGreaterThan(0);
  });

  it('caves have no doors and use cavern shapes', () => {
    const { map } = generateDungeon('wyrm-hollow', { theme: 'cave' });
    expect(map.objects.some((o) => o.kind === 'door')).toBe(false);
    expect(map.objects.filter((o) => o.kind === 'room').every((o) => o.kind === 'room' && (o.shape === 'cave' || o.shape === 'round'))).toBe(true);
  });

  it('never puts a pillar or pit on a room center', () => {
    for (const s of seeds.slice(0, 60)) {
      const { map } = generateDungeon(s);
      for (const o of map.objects) {
        if (o.kind !== 'room') continue;
        const c = rectCenter(o.rect);
        expect(['floor', 'stairs']).toContain(terrainAt(map, c.x, c.y));
      }
    }
  });
});

describe('campaign schema', () => {
  const campaign = (): Campaign => ({
    schemaVersion: SCHEMA_VERSION,
    id: 'c1',
    name: 'Test',
    ruleset: { edition: 'dnd-2024', version: 'srd-5.2.1' },
    maps: [generateDungeon('round-trip').map],
    tokens: [],
    settings: { grid: { diagonal: 'uniform', closedDoors: 'block' } },
  });

  it('round-trips a generated map through JSON', () => {
    const c = campaign();
    const parsed = parseCampaign(JSON.parse(JSON.stringify(c)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.campaign).toEqual(c);
  });

  it('rejects malformed imports without throwing', () => {
    const bad = campaign() as unknown as Record<string, unknown>;
    (bad.maps as { terrain: string[] }[])[0].terrain.pop();
    const res = parseCampaign(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/terrain has/);
    expect(parseCampaign('not json at all').ok).toBe(false);
    expect(parseCampaign({ ...campaign(), schemaVersion: 99 }).ok).toBe(false);
  });
});
