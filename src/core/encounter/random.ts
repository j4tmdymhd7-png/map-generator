/**
 * Random encounters, placed out of the party's sight.
 *
 * The table is a placeholder until real monster data is loaded: each entry
 * only needs a name, size, speed and group size.
 */
import { idx, rectCenter } from '../model/grid';
import type { DungeonMap, RoomObject, Size, Token } from '../model/types';
import type { Rng } from '../rng';
import { FOG_HIDDEN } from '../visibility/fog';
import { placeGroup } from './placement';

export interface EncounterEntry {
  name: string;
  size: Size;
  speed: number;
  min: number;
  max: number;
  weight?: number;
}

export const PLACEHOLDER_TABLE: EncounterEntry[] = [
  { name: 'Grunt', size: 'medium', speed: 30, min: 2, max: 4, weight: 3 },
  { name: 'Skulker', size: 'small', speed: 30, min: 2, max: 5, weight: 2 },
  { name: 'Brute', size: 'large', speed: 40, min: 1, max: 1, weight: 1 },
  { name: 'Lurker', size: 'medium', speed: 20, min: 1, max: 2, weight: 1 },
];

export interface EncounterResult {
  tokens: Token[];
  room: RoomObject;
  entry: EncounterEntry;
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

function pickWeighted(rng: Rng, table: EncounterEntry[]): EncounterEntry {
  const total = table.reduce((s, e) => s + (e.weight ?? 1), 0);
  let roll = rng.next() * total;
  for (const e of table) {
    roll -= e.weight ?? 1;
    if (roll < 0) return e;
  }
  return table[table.length - 1];
}

/**
 * Roll an encounter and place it in an unseen room. Returns null when no room
 * qualifies (everything explored, or the party is close to every unseen room).
 */
export function rollEncounter(
  map: DungeonMap,
  tokens: Token[],
  fog: Uint8Array,
  rng: Rng,
  newId: () => string,
  table: EncounterEntry[] = PLACEHOLDER_TABLE,
  minDistance = 8,
): EncounterResult | null {
  const rooms = unseenRooms(map, tokens, fog, minDistance);
  if (rooms.length === 0 || table.length === 0) return null;
  const room = rng.pick(rooms);
  const entry = pickWeighted(rng, table);
  const count = rng.int(entry.min, entry.max);
  const group: Token[] = Array.from({ length: count }, (_, i) => ({
    id: newId(),
    mapId: map.id,
    label: count > 1 ? `${entry.name} ${i + 1}` : entry.name,
    color: '#8a8a8a',
    size: entry.size,
    position: { x: 0, y: 0 },
    speeds: { walk: entry.speed },
    senses: {},
    side: 'enemy',
    conditions: [],
    visibility: 'public',
  }));
  const placed = placeGroup(map, group, rectCenter(room.rect), tokens);
  return { tokens: placed, room, entry };
}
