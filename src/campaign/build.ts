/**
 * Turning a freshly generated map into a campaign map: loot in the chests,
 * people at their places, guards in the lair. And a whole new campaign.
 *
 * Pure functions (no React), so they're tested directly.
 */
import { placeGroup, startPoint } from '../core/encounter/placement';
import { generateMap, type MapKind, type MapSize } from '../core/generator/maps';
import { STARTER_CREATURES, tokenFromTemplate, type CreatureTemplate } from '../core/library/creatures';
import { rollLoot, stockDungeon, tierForLevel } from '../core/loot/generate';
import type { ItemDef } from '../core/loot/items';
import { rectCenter } from '../core/model/grid';
import { SCHEMA_VERSION, type Campaign, type DungeonMap, type NameStyle, type Npc, type PoiObject, type RoomObject, type StatBlock, type Token } from '../core/model/types';
import { createRng } from '../core/rng';
import { populatePois } from '../core/world/npcs';
import { POI_INFO } from '../core/world/poi';

export interface BuildContext {
  items: ItemDef[];
  creatures: CreatureTemplate[];
  partyLevel: number;
  /** Unique items already handed out. */
  used: Set<string>;
  style: NameStyle;
  newId: () => string;
}

const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });
const pc = (ac: number, hp: number, abilities: StatBlock['abilities']): StatBlock => ({ ac, hp, maxHp: hp, abilities, notes: 'Placeholder stats: replace with the character sheet.' });

/** The demo party: placeholder heroes to rename and re-stat. */
export function demoParty(mapId: string, newId: () => string): Token[] {
  const base = { mapId, position: { x: 0, y: 0 }, senses: {}, conditions: [], visibility: 'public' as const };
  return [
    { ...base, id: newId(), label: 'Brannoc', color: '#0072b2', size: 'medium', speeds: { walk: 30 }, side: 'party', stats: pc(18, 31, ab(16, 12, 15, 10, 12, 8)) },
    { ...base, id: newId(), label: 'Ilsa Vane', color: '#e69f00', size: 'medium', speeds: { walk: 30 }, side: 'party', stats: pc(12, 17, ab(8, 14, 13, 17, 12, 10)) },
    { ...base, id: newId(), label: 'Tamsin', color: '#009e73', size: 'small', speeds: { walk: 30 }, side: 'party', stats: pc(15, 22, ab(10, 17, 13, 12, 12, 13)) },
    { ...base, id: newId(), label: 'Old Grimm', color: '#cc79a7', size: 'medium', speeds: { walk: 30 }, side: 'party', stats: pc(17, 27, ab(14, 10, 15, 10, 16, 11)) },
  ];
}

/** A token for an NPC card. Hostile NPCs count as enemies on the board. */
export function npcToken(npc: Npc, mapId: string, id: string): Token {
  return {
    id,
    mapId,
    label: npc.name,
    color: '#8a8a8a',
    size: 'medium',
    position: { x: 0, y: 0 },
    speeds: { walk: 30 },
    senses: {},
    side: npc.attitude === 'hostile' ? 'enemy' : 'neutral',
    conditions: [],
    visibility: 'public',
    behavior: 'still',
    npcId: npc.id,
    stats: { ac: 10, hp: 4, maxHp: 4, abilities: ab(10, 10, 10, 10, 10, 10), notes: 'Commoner-level placeholder: give important NPCs a real stat block.' },
  };
}

/** Where guards wait: the exit stairs, else the last room (the generators list the lair last). */
function lairPoint(map: DungeonMap) {
  const exit = map.objects.find((o) => o.kind === 'stairs' && o.role === 'exit');
  if (exit && exit.kind === 'stairs') return exit.at;
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
  return rooms.length ? rectCenter(rooms[rooms.length - 1].rect) : startPoint(map);
}

export interface Built {
  map: DungeonMap;
  /** New NPC cards for this map's places. */
  npcs: Npc[];
  /** New non-party tokens (people, guards). */
  tokens: Token[];
}

/**
 * Stock a newly generated map.
 * - every map: loot in its rooms;
 * - towns and wilds: an NPC card for the people at each place, with tokens
 *   for those who work outdoors (market, gate, camp);
 * - interiors: tokens for the staff of the place it belongs to;
 * - dungeons and caves: two guards in the lair.
 */
export function buildMap(generated: DungeonMap, ctx: BuildContext, campaignNpcs: Npc[], parentPoi?: PoiObject): Built {
  const seed = generated.generation?.seed ?? generated.id;
  const map: DungeonMap = {
    ...generated,
    objects: [...generated.objects.filter((o) => o.kind !== 'loot'), ...stockDungeon(generated, createRng(`${seed}:loot`), ctx.items, ctx.partyLevel, ctx.used)],
  };
  const npcs: Npc[] = [];
  let tokens: Token[] = [];
  const pois = map.objects.filter((o): o is PoiObject => o.kind === 'poi');

  if (pois.length) {
    npcs.push(...populatePois(map.id, pois, seed, ctx.style, ctx.items));
    for (const poi of pois) {
      if (POI_INFO[poi.poiType].inside) continue; // indoor staff appear when the party goes in
      const here = npcs.filter((n) => n.workPoiId === poi.id).map((n) => npcToken(n, map.id, ctx.newId()));
      tokens = [...tokens, ...placeGroup(map, here, poi.at, tokens)];
    }
  }

  if (map.style === 'interior') {
    let staff: Npc[];
    if (parentPoi) staff = campaignNpcs.filter((n) => n.workPoiId === parentPoi.id);
    else {
      // A stand-alone building: make its people now.
      const self: PoiObject = { id: `poi-self-${map.id}`, kind: 'poi', poiType: map.recipe?.kind === 'manor' ? 'estate' : 'tavern', name: map.title, at: startPoint(map), visibility: 'public' };
      staff = populatePois(map.id, [self], seed, ctx.style, ctx.items).map((n) => ({ ...n, workPoiId: undefined, notes: `Works at ${map.title}.` }));
      npcs.push(...staff);
    }
    const main = map.objects.find((o): o is RoomObject => o.kind === 'room');
    // Beside the room's middle (where its number is written).
    const where = main ? { x: rectCenter(main.rect).x + 2, y: rectCenter(main.rect).y } : startPoint(map);
    tokens = [...tokens, ...placeGroup(map, staff.map((n) => npcToken(n, map.id, ctx.newId())), where, tokens)];
  }

  if (map.style === 'dungeon' || map.style === undefined) {
    const tier = tierForLevel(ctx.partyLevel);
    const template = (id: string) => ctx.creatures.find((c) => c.id === id) ?? STARTER_CREATURES.find((c) => c.id === id)!;
    const foes = ['ogre', 'goblin-boss'].map((id) => {
      const tpl = template(id);
      const t = tokenFromTemplate(tpl, ctx.newId(), map.id);
      t.color = id === 'ogre' ? '#d55e00' : '#56b4e9';
      t.behavior = 'guard';
      t.leash = 6;
      if (tpl.carriesLoot) t.inventory = rollLoot(createRng(`${seed}:${id}:pocket`), tier, 'pocket', ctx.items, ctx.used);
      return t;
    });
    const placed = placeGroup(map, foes, lairPoint(map), tokens).map((t) => ({ ...t, home: t.position }));
    tokens = [...tokens, ...placed];
  }

  return { map, npcs, tokens };
}

let campaignN = 0;
export function newCampaignId(): string {
  return `camp-${Date.now().toString(36)}-${++campaignN}`;
}

/** A new campaign: one generated map, the demo party at its entrance, and whatever lives there. */
export function createCampaign(name: string, recipe: { seed: string; size: MapSize; kind: MapKind }, ctx: BuildContext): Campaign {
  const res = generateMap(recipe.seed, recipe.size, recipe.kind, ctx.style);
  const built = buildMap(res.map, ctx, []);
  const party = placeGroup(built.map, demoParty(built.map.id, ctx.newId), startPoint(built.map), built.tokens);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newCampaignId(),
    name,
    ruleset: { edition: 'dnd-2024', version: 'srd-5.2.1' },
    maps: [built.map],
    tokens: [...party, ...built.tokens],
    settings: { grid: { diagonal: 'uniform', closedDoors: 'passable' }, partyLevel: ctx.partyLevel, nameStyle: ctx.style },
    activeMapId: built.map.id,
    npcs: built.npcs,
    fog: {},
    clock: { day: 1, minute: 8 * 60 },
    updatedAt: new Date().toISOString(),
  };
}

/** All maps under `id` (interiors of its places, and theirs), not including `id`. */
export function descendants(maps: DungeonMap[], id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const m of maps) if (m.parent?.mapId === pid) {
      out.push(m.id);
      walk(m.id);
    }
  };
  walk(id);
  return out;
}

/** Maps in tree order (each map followed by its interiors), with their depth. */
export function mapTree(maps: DungeonMap[]): { map: DungeonMap; depth: number }[] {
  const out: { map: DungeonMap; depth: number }[] = [];
  const ids = new Set(maps.map((m) => m.id));
  const walk = (m: DungeonMap, depth: number) => {
    out.push({ map: m, depth });
    for (const c of maps) if (c.parent?.mapId === m.id) walk(c, depth + 1);
  };
  for (const m of maps) if (!m.parent || !ids.has(m.parent.mapId)) walk(m, 0);
  return out;
}

/** A map id not already used in the campaign. */
export function uniqueMapId(maps: DungeonMap[], id: string): string {
  if (!maps.some((m) => m.id === id)) return id;
  let n = 2;
  while (maps.some((m) => m.id === `${id}~${n}`)) n++;
  return `${id}~${n}`;
}
