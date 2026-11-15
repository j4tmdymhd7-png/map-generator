import { describe, expect, it } from 'vitest';
import { generateInterior, type InteriorKind } from '../generator/interior';
import { generateLinked, generateMap } from '../generator/maps';
import { idx } from '../model/grid';
import { decodeFog, encodeFog, parseCampaign } from '../model/schema';
import { SCHEMA_VERSION, type Campaign, type PoiObject } from '../model/types';
import { isWalkable } from '../model/terrain';
import { STARTER_ITEMS } from '../loot/items';
import { createRng } from '../rng';
import { personName } from './names';
import { populatePois } from './npcs';
import { POI_INFO } from './poi';

const pois = (m: ReturnType<typeof generateMap>['map']) => m.objects.filter((o): o is PoiObject => o.kind === 'poi');

describe('points of interest', () => {
  it('a city gets a full set of named places, each with a walkable entrance', () => {
    const { map } = generateMap('poi-city', 'gargantuan', 'city');
    const ps = pois(map);
    const types = new Set(ps.map((p) => p.poiType));
    for (const t of ['tavern', 'inn', 'temple', 'smithy', 'market', 'gatehouse', 'estate', 'thieves-den', 'general-store'] as const) expect(types, t).toContain(t);
    expect(ps.filter((p) => p.poiType === 'gatehouse')).toHaveLength(4);
    expect(new Set(ps.map((p) => p.name)).size, 'unique names').toBe(ps.length);
    for (const p of ps) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(isWalkable(map.terrain[idx(map, p.at.x, p.at.y)]), `${p.name} entrance`).toBe(true);
    }
    // The thieves' den is DM-only.
    expect(ps.find((p) => p.poiType === 'thieves-den')!.visibility).toBe('dm');
  });

  it('places are deterministic per seed', () => {
    const a = pois(generateMap('same', 'huge', 'town').map).map((p) => `${p.poiType}:${p.name}:${p.at.x},${p.at.y}`);
    const b = pois(generateMap('same', 'huge', 'town').map).map((p) => `${p.poiType}:${p.name}:${p.at.x},${p.at.y}`);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it('wilderness gets camps, huts and shrines, and the map stays valid', () => {
    for (const seed of ['wild-1', 'wild-2', 'wild-3']) {
      const res = generateMap(seed, 'gargantuan', 'wilderness');
      expect(res.issues.filter((i) => i.severity === 'error')).toEqual([]);
      const ps = pois(res.map);
      expect(ps.length).toBeGreaterThanOrEqual(6);
      expect(new Set(ps.map((p) => p.name)).size, 'unique names').toBe(ps.length);
      // At most two of the same ready-made kind
      for (const t of ['standing-stones', 'ruins', 'campsite'] as const) expect(ps.filter((p) => p.poiType === t).length).toBeLessThanOrEqual(2);
      for (const p of ps) expect(isWalkable(res.map.terrain[idx(res.map, p.at.x, p.at.y)]), `${seed} ${p.name}`).toBe(true);
    }
  });

  it('every enterable place opens into a valid linked map', () => {
    const { map } = generateMap('enter', 'gargantuan', 'city');
    const forest = generateMap('enter', 'gargantuan', 'wilderness').map;
    for (const [parent, p] of [...pois(map).map((p) => [map, p] as const), ...pois(forest).map((p) => [forest, p] as const)]) {
      const res = generateLinked(parent, p);
      if (!POI_INFO[p.poiType].inside) {
        expect(res).toBeNull();
        continue;
      }
      expect(res, p.name).not.toBeNull();
      expect(res!.issues.filter((i) => i.severity === 'error'), p.name).toEqual([]);
      expect(res!.map.parent).toEqual({ mapId: parent.id, poiId: p.id });
      expect(res!.map.title).toBe(p.name);
    }
  });
});

describe('interiors', () => {
  const kinds: InteriorKind[] = ['tavern', 'inn', 'manor', 'shop', 'smithy', 'temple', 'barracks', 'den', 'warehouse', 'stables', 'cottage'];
  it.each(kinds)('%s interiors are valid across seeds', (kind) => {
    for (let s = 0; s < 6; s++) {
      const res = generateInterior(`k${s}`, kind);
      expect(res.issues.filter((i) => i.severity === 'error'), `${kind} k${s}`).toEqual([]);
      expect(res.map.objects.filter((o) => o.kind === 'room').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('NPCs', () => {
  it('generic names look like names and repeat per seed', () => {
    const a = personName(createRng('n'));
    expect(a).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(personName(createRng('n'))).toBe(a);
  });

  it('every place with staff gets a proprietor; merchants get stock from the library', () => {
    const { map } = generateMap('people', 'gargantuan', 'city');
    const ps = pois(map);
    const npcs = populatePois(map.id, ps, 'people', 'generic', STARTER_ITEMS);
    expect(npcs.length).toBeGreaterThan(ps.length - 2);
    const smithy = ps.find((p) => p.poiType === 'smithy')!;
    const smith = npcs.find((n) => n.workPoiId === smithy.id)!;
    expect(smith.occupation).toBe('Blacksmith');
    expect(smith.known).toBe(false);
    expect(smith.shop!.length).toBeGreaterThan(0);
    for (const id of smith.shop!) expect(STARTER_ITEMS.find((i) => i.id === id)?.category).toBe('gear');
  });
});

describe('campaign files', () => {
  it('fog survives encoding', () => {
    const fog = new Uint8Array(1000);
    fog.fill(1, 100, 350);
    fog.fill(2, 400, 410);
    const back = decodeFog(encodeFog(fog), 1000)!;
    expect([...back]).toEqual([...fog].map((v) => (v ? 1 : 0)));
    expect(decodeFog(encodeFog(fog), 999)).toBeNull();
  });

  it('round-trips a campaign with linked maps and NPCs, and upgrades version 1 files', () => {
    const city = generateMap('file', 'huge', 'town').map;
    const tavern = pois(city).find((p) => p.poiType === 'tavern')!;
    const inside = generateLinked(city, tavern)!.map;
    tavern.link = { mapId: inside.id };
    const npcs = populatePois(city.id, pois(city), 'file', 'generic', STARTER_ITEMS);
    const c: Campaign = {
      schemaVersion: SCHEMA_VERSION,
      id: 'camp-1',
      name: 'Test',
      ruleset: { edition: 'dnd-2024', version: 'srd-5.2.1' },
      maps: [city, inside],
      tokens: [],
      settings: { grid: { diagonal: 'uniform', closedDoors: 'block' }, partyLevel: 3, nameStyle: 'generic' },
      activeMapId: inside.id,
      npcs,
      fog: { [city.id]: '01000' },
    };
    const res = parseCampaign(JSON.parse(JSON.stringify(c)));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.campaign.maps[1].parent).toEqual({ mapId: city.id, poiId: tavern.id });
      expect(res.campaign.npcs).toHaveLength(npcs.length);
    }
    const v1 = parseCampaign({ ...JSON.parse(JSON.stringify(c)), schemaVersion: 1, npcs: undefined, fog: undefined });
    expect(v1.ok && v1.campaign.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
