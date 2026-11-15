import { describe, expect, it } from 'vitest';
import { generateLinked, generateMap } from '../core/generator/maps';
import { STARTER_CREATURES } from '../core/library/creatures';
import { STARTER_ITEMS } from '../core/loot/items';
import { parseCampaign } from '../core/model/schema';
import type { PoiObject } from '../core/model/types';
import { buildMap, createCampaign, descendants, mapTree, uniqueMapId, type BuildContext } from './build';

let n = 0;
const ctx: BuildContext = { items: STARTER_ITEMS, creatures: STARTER_CREATURES, partyLevel: 3, used: new Set(), style: 'generic', newId: () => `t${++n}` };

describe('campaign building', () => {
  it('a new dungeon campaign has the party, two lair guards and loot, and is a valid file', () => {
    const c = createCampaign('Test', { seed: 'camp', size: 'medium', kind: 'dungeon' }, ctx);
    expect(c.tokens.filter((t) => t.side === 'party')).toHaveLength(4);
    expect(c.tokens.filter((t) => t.behavior === 'guard')).toHaveLength(2);
    expect(c.maps[0].objects.some((o) => o.kind === 'loot')).toBe(true);
    expect(parseCampaign(JSON.parse(JSON.stringify(c))).ok).toBe(true);
  });

  it('a town gets NPC cards for its places, with tokens only for people who work outdoors', () => {
    const map = generateMap('people-town', 'huge', 'town').map;
    const built = buildMap(map, ctx, []);
    expect(built.npcs.length).toBeGreaterThan(8);
    expect(built.tokens.every((t) => t.npcId)).toBe(true);
    const pois = built.map.objects.filter((o): o is PoiObject => o.kind === 'poi');
    const outdoor = new Set(pois.filter((p) => p.poiType === 'market').map((p) => p.id));
    for (const t of built.tokens) expect(outdoor.has(built.npcs.find((n) => n.id === t.npcId)!.workPoiId!)).toBe(true);
  });

  it('going into a building puts its staff inside', () => {
    const town = buildMap(generateMap('staff', 'huge', 'town').map, ctx, []);
    const tavern = town.map.objects.find((o): o is PoiObject => o.kind === 'poi' && o.poiType === 'tavern')!;
    const inside = buildMap(generateLinked(town.map, tavern)!.map, ctx, town.npcs, tavern);
    const staff = town.npcs.filter((n) => n.workPoiId === tavern.id);
    expect(staff.length).toBeGreaterThan(0);
    expect(inside.tokens.map((t) => t.npcId).sort()).toEqual(staff.map((s) => s.id).sort());
    expect(inside.tokens.every((t) => t.mapId === inside.map.id)).toBe(true);
    expect(inside.npcs).toEqual([]); // no new cards: they already exist
  });

  it('a stand-alone tavern makes its own people', () => {
    const built = buildMap(generateMap('alone', 'small', 'tavern').map, ctx, []);
    expect(built.npcs.length).toBeGreaterThan(0);
    expect(built.tokens.length).toBe(built.npcs.length);
  });

  it('map trees, descendants and unique ids', () => {
    const a = generateMap('tree', 'huge', 'town').map;
    const poi = a.objects.find((o): o is PoiObject => o.kind === 'poi' && o.poiType === 'inn')!;
    const b = generateLinked(a, poi)!.map;
    const other = generateMap('other', 'medium', 'cave').map;
    const maps = [b, other, a];
    expect(mapTree(maps).map((e) => [e.map.id, e.depth])).toEqual([
      [other.id, 0],
      [a.id, 0],
      [b.id, 1],
    ]);
    expect(descendants(maps, a.id)).toEqual([b.id]);
    expect(uniqueMapId(maps, a.id)).toBe(`${a.id}~2`);
    expect(uniqueMapId(maps, 'fresh')).toBe('fresh');
  });
});
