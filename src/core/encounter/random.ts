/**
 * Random encounters, placed out of the party's sight. Creatures come from the
 * creature library (entries marked for encounters), with full stat blocks.
 */
import { STARTER_CREATURES, tokenFromTemplate, type CreatureTemplate } from '../library/creatures';
import { rollLoot, type Tier } from '../loot/generate';
import type { ItemDef } from '../loot/items';
import { idx, rectCenter } from '../model/grid';
import type { DungeonMap, RoomObject, Token } from '../model/types';
import type { Rng } from '../rng';
import { FOG_HIDDEN } from '../visibility/fog';
import { placeGroup } from './placement';

export interface EncounterResult {
  tokens: Token[];
  room: RoomObject;
  entry: CreatureTemplate;
}

/** Rooms the party has never seen any part of, at least `minDistance` squares from every party member. */
export function unseenRooms(map: DungeonMap, tokens: Token[], fog: Uint8Array, minDistance: number): RoomObject[] {
  const party = tokens.filter((t) => t.side === 'party' && t.mapId === map.id);
  return map.objects.filter((o): o is RoomObject => {
    if (o.kind !== 'room') return false;
    const { x, y, w, h } = o.rect;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const t = map.terrain[idx(map, xx, yy)];
        if (t !== 'void' && t !== 'wall' && fog[idx(map, xx, yy)] !== FOG_HIDDEN) return false;
      }
    const c = rectCenter(o.rect);
    return party.every((p) => Math.max(Math.abs(p.position.x - c.x), Math.abs(p.position.y - c.y)) >= minDistance);
  });
}

function pickWeighted(rng: Rng, table: CreatureTemplate[]): CreatureTemplate {
  const total = table.reduce((s, e) => s + Math.max(0, e.weight), 0);
  let roll = rng.next() * total;
  for (const e of table) {
    roll -= Math.max(0, e.weight);
    if (roll < 0) return e;
  }
  return table[table.length - 1];
}

/**
 * Roll an encounter and place it in an unseen room. Returns null when no room
 * qualifies (everything explored, or the party is close to every unseen room).
 */
export interface LootContext {
  items: ItemDef[];
  tier: Tier;
  used: Set<string>;
}

export function rollEncounter(
  map: DungeonMap,
  tokens: Token[],
  fog: Uint8Array,
  rng: Rng,
  newId: () => string,
  library: CreatureTemplate[] = STARTER_CREATURES,
  loot?: LootContext,
  minDistance = 8,
): EncounterResult | null {
  const table = library.filter((c) => c.encounters && c.weight > 0);
  const rooms = unseenRooms(map, tokens, fog, minDistance);
  if (rooms.length === 0 || table.length === 0) return null;
  const room = rng.pick(rooms);
  const entry = pickWeighted(rng, table);
  const count = rng.int(Math.max(1, entry.groupMin), Math.max(entry.groupMin, entry.groupMax, 1));
  const group: Token[] = Array.from({ length: count }, (_, i) => {
    const t = tokenFromTemplate(entry, newId(), map.id, count > 1 ? `${entry.name} ${i + 1}` : entry.name);
    if (loot && entry.carriesLoot) t.inventory = rollLoot(rng, loot.tier, 'pocket', loot.items, loot.used);
    return t;
  });
  const placed = placeGroup(map, group, rectCenter(room.rect), tokens);
  return { tokens: placed, room, entry };
}
