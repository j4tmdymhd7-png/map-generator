/**
 * One entry point for every map size and type.
 *
 *   small       tavern, manor            building interiors
 *   medium      dungeon, cave            40 x 40
 *   large       dungeon, cave            80 x 80
 *   huge        forest, town             120 x 120
 *   gargantuan  wilderness, city         200 x 200
 */
import { generateDungeon, type GenerateResult } from './generate';
import { generateInterior } from './interior';
import { validateDungeon } from './validate';
import { generateForest, generateTown } from './outdoor';
import type { DungeonMap, NameStyle, PoiObject } from '../model/types';
import { placeTownPois, placeWildPois, POI_INFO } from '../world/poi';

export const MAP_SIZES = ['small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type MapSize = (typeof MAP_SIZES)[number];
export type MapKind = 'tavern' | 'manor' | 'dungeon' | 'cave' | 'forest' | 'town' | 'wilderness' | 'city';

export const SIZE_INFO: Record<MapSize, { label: string; blurb: string; kinds: { kind: MapKind; label: string }[] }> = {
  small: {
    label: 'Small',
    blurb: 'Building interiors',
    kinds: [
      { kind: 'tavern', label: 'Tavern / inn' },
      { kind: 'manor', label: 'Manor' },
    ],
  },
  medium: {
    label: 'Medium',
    blurb: '40 × 40 · low-level dungeons and caves',
    kinds: [
      { kind: 'dungeon', label: 'Dungeon' },
      { kind: 'cave', label: 'Caves' },
    ],
  },
  large: {
    label: 'Large',
    blurb: '80 × 80 · complex dungeons, cave systems',
    kinds: [
      { kind: 'dungeon', label: 'Dungeon' },
      { kind: 'cave', label: 'Cave system' },
    ],
  },
  huge: {
    label: 'Huge',
    blurb: '120 × 120 · towns and forests',
    kinds: [
      { kind: 'town', label: 'Town' },
      { kind: 'forest', label: 'Forest' },
    ],
  },
  gargantuan: {
    label: 'Gargantuan',
    blurb: '200 × 200 · walled cities, wilderness',
    kinds: [
      { kind: 'city', label: 'Walled city' },
      { kind: 'wilderness', label: 'Wilderness' },
    ],
  },
};

export function generateMap(seed: string, size: MapSize, kind: MapKind, style: NameStyle = 'generic'): GenerateResult {
  const res = generateBase(seed, size, kind);
  res.map.recipe = { size, kind };
  if (size === 'huge' || size === 'gargantuan') {
    if (kind === 'forest' || kind === 'wilderness') placeWildPois(res.map, seed, style);
    else placeTownPois(res.map, seed, style);
    res.issues = validateDungeon(res.map);
  }
  return res;
}

/**
 * The map behind a place's door: a building interior, or a cave or crypt
 * under the wilds. Deterministic for a given parent map and place.
 */
export function generateLinked(parent: DungeonMap, poi: PoiObject): GenerateResult | null {
  const inside = POI_INFO[poi.poiType].inside;
  if (!inside) return null;
  const seed = `${parent.generation?.seed ?? parent.id}:${poi.id}`;
  let res: GenerateResult;
  if ('interior' in inside) {
    res = generateInterior(seed, inside.interior);
    res.map.recipe = { size: 'small', kind: inside.interior };
  } else {
    const theme = inside.underground === 'cave' ? 'cave' : 'dungeon';
    res = generateDungeon(seed, { theme });
    res.map.style = 'dungeon';
    res.map.recipe = { size: 'medium', kind: theme };
  }
  res.map.id = `${parent.id}>${poi.id}`;
  res.map.title = poi.name;
  res.map.parent = { mapId: parent.id, poiId: poi.id };
  return res;
}

function generateBase(seed: string, size: MapSize, kind: MapKind): GenerateResult {
  switch (size) {
    case 'small':
      return generateInterior(seed, kind === 'manor' ? 'manor' : 'tavern');
    case 'medium':
    case 'large': {
      const theme = kind === 'cave' ? 'cave' : 'dungeon';
      const big = size === 'large';
      const res = generateDungeon(
        seed,
        big
          ? { theme, width: 80, height: 80, rooms: { min: 18, max: 28 }, roomSize: { min: 4, max: 12 }, loopChance: 0.22, deadEnds: 7 }
          : { theme },
      );
      res.map.id = `map-${size}-${theme}-${seed}`;
      res.map.title = `${big ? 'Large ' : ''}${theme === 'cave' ? 'Caves' : 'Dungeon'} ${seed}`;
      res.map.style = 'dungeon';
      return res;
    }
    case 'huge':
      return kind === 'forest' ? generateForest(seed, 'huge') : generateTown(seed, 'huge');
    case 'gargantuan':
      return kind === 'wilderness' ? generateForest(seed, 'gargantuan') : generateTown(seed, 'gargantuan');
  }
}
