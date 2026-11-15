/**
 * Loot generation. Amounts and odds are this project's own tuning by party
 * tier, not tables from any book. Everything rolled is editable afterwards.
 */
import { idx, rectCenter } from '../model/grid';
import { isStandable } from '../model/terrain';
import type { DungeonMap, ItemStack, LootObject, Point, Rarity, RoomObject } from '../model/types';
import type { Rng } from '../rng';
import { COIN_TYPES, type ItemDef } from './items';

export type Tier = 1 | 2 | 3 | 4;
export type LootKind = 'pocket' | 'cache' | 'hoard';

/** Party level 1-4 / 5-10 / 11-16 / 17-20. */
export function tierForLevel(level: number): Tier {
  return level <= 4 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4;
}

const COIN_SCALE: Record<Tier, number> = { 1: 4, 2: 30, 3: 150, 4: 700 };
const KIND_SCALE: Record<LootKind, number> = { pocket: 1, cache: 4, hoard: 15 };
/** Odds of each rarity when a magic item is rolled, by tier. */
const RARITY_WEIGHTS: Record<Tier, Partial<Record<Rarity, number>>> = {
  1: { common: 5, uncommon: 4, rare: 1 },
  2: { uncommon: 5, rare: 4, 'very rare': 1 },
  3: { rare: 5, 'very rare': 4, legendary: 1 },
  4: { 'very rare': 5, legendary: 3, rare: 2 },
};
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
/** Most valuable gem/art object that fits each tier. */
const VALUABLE_CAP: Record<Tier, number> = { 1: 250, 2: 1000, 3: 5000, 4: 10000 };

let stackCounter = 0;
export function stackId(): string {
  return `stk-${Date.now().toString(36)}-${(stackCounter++).toString(36)}`;
}

export function stackFrom(def: ItemDef, qty = 1): ItemStack {
  return {
    id: stackId(),
    name: def.name,
    category: def.category,
    qty,
    valueGp: def.valueGp,
    rarity: def.rarity,
    description: def.description,
    dmNote: def.dmNote,
    defId: def.id,
  };
}

function coins(rng: Rng, tier: Tier, kind: LootKind): ItemStack[] {
  const budget = Math.round(COIN_SCALE[tier] * KIND_SCALE[kind] * (0.5 + rng.next() * 1.5));
  const out: ItemStack[] = [];
  const add = (key: (typeof COIN_TYPES)[number]['key'], qty: number) => {
    if (qty <= 0) return;
    const t = COIN_TYPES.find((c) => c.key === key)!;
    out.push({ id: stackId(), name: t.name, category: 'coins', qty, valueGp: t.valueGp });
  };
  if (tier === 1) {
    add('cp', rng.int(0, 40) * (kind === 'pocket' ? 1 : 3));
    add('sp', rng.int(0, 20) * (kind === 'pocket' ? 1 : 3));
    add('gp', budget);
  } else {
    add('gp', budget);
    if (tier >= 3 && kind !== 'pocket') add('pp', Math.round(budget / 40));
  }
  return out;
}

/** Library items eligible for random loot: marked random, not a used unique. */
function eligible(items: ItemDef[], used: Set<string>, filter: (d: ItemDef) => boolean): ItemDef[] {
  return items.filter((d) => d.random && !(d.unique && used.has(d.id)) && filter(d));
}

function take(rng: Rng, pool: ItemDef[], used: Set<string>): ItemDef | null {
  if (pool.length === 0) return null;
  const d = rng.pick(pool);
  if (d.unique) used.add(d.id);
  return d;
}

function pickRarity(rng: Rng, tier: Tier): Rarity {
  const entries = Object.entries(RARITY_WEIGHTS[tier]) as [Rarity, number][];
  let roll = rng.next() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [r, w] of entries) {
    roll -= w;
    if (roll < 0) return r;
  }
  return entries[0][0];
}

/**
 * Roll one batch of loot.
 * pocket = what a creature carries, cache = a chest in a room, hoard = the boss's lair.
 * `used` tracks unique items already handed out (shared across the campaign).
 */
export function rollLoot(rng: Rng, tier: Tier, kind: LootKind, items: ItemDef[], used: Set<string> = new Set()): ItemStack[] {
  const out = coins(rng, tier, kind);
  const merge = (d: ItemDef | null) => {
    if (!d) return;
    const same = out.find((s) => s.defId === d.id && !d.unique);
    if (same) same.qty++;
    else out.push(stackFrom(d));
  };

  const gearOdds = { pocket: 0.3, cache: 0.8, hoard: 1 }[kind];
  if (rng.chance(gearOdds)) merge(take(rng, eligible(items, used, (d) => d.category === 'gear'), used));
  const consumables = { pocket: rng.chance(0.15) ? 1 : 0, cache: rng.int(0, 2), hoard: rng.int(1, 3) }[kind];
  for (let i = 0; i < consumables; i++) merge(take(rng, eligible(items, used, (d) => d.category === 'consumable'), used));

  const valuables = { pocket: rng.chance(0.1) ? 1 : 0, cache: rng.int(0, 2), hoard: rng.int(2, 5) }[kind];
  for (let i = 0; i < valuables; i++)
    merge(take(rng, eligible(items, used, (d) => (d.category === 'gem' || d.category === 'art') && (d.valueGp ?? 0) <= VALUABLE_CAP[tier]), used));

  const magic = { pocket: rng.chance(0.03) ? 1 : 0, cache: rng.chance(0.25 + tier * 0.05) ? 1 : 0, hoard: rng.int(1, Math.min(4, tier + 1)) }[kind];
  for (let i = 0; i < magic; i++) {
    // Try the rolled rarity, then step down; never step above what the tier allows.
    const order = RARITY_ORDER.slice(0, RARITY_ORDER.indexOf(pickRarity(rng, tier)) + 1).reverse();
    for (const rarity of order) {
      const pool = eligible(items, used, (d) => d.category === 'magic' && d.rarity === rarity);
      if (pool.length) {
        merge(take(rng, pool, used));
        break;
      }
    }
  }
  // Quest and other random-eligible custom categories the DM added can turn up in caches and hoards.
  if (kind !== 'pocket' && rng.chance(kind === 'hoard' ? 0.5 : 0.15))
    merge(take(rng, eligible(items, used, (d) => d.category === 'quest'), used));
  return out;
}

export function lootValueGp(stacks: ItemStack[]): number {
  return Math.round(stacks.reduce((s, x) => s + (x.valueGp ?? 0) * x.qty, 0) * 100) / 100;
}

function freeSpotInRoom(map: DungeonMap, room: RoomObject, rng: Rng, taken: Set<number>): Point | null {
  const c = rectCenter(room.rect);
  const near = (x: number, y: number, t: string) =>
    [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => map.terrain[idx(map, x + dx, y + dy)] === t));
  const candidates = (strict: boolean): Point[] => {
    const out: Point[] = [];
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++)
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
        const i = idx(map, x, y);
        if (!isStandable(map.terrain[i]) || map.flags[i] & 1 || taken.has(i) || (x === c.x && y === c.y)) continue;
        // Prefer keeping the middle and the doorways clear; small rooms fall back to anywhere free.
        if (strict && ((Math.abs(x - c.x) <= 1 && Math.abs(y - c.y) <= 1) || near(x, y, 'door') || near(x, y, 'stairs'))) continue;
        out.push({ x, y });
      }
    return out;
  };
  const strict = candidates(true);
  const spots = strict.length ? strict : candidates(false);
  return spots.length ? rng.pick(spots) : null;
}

/**
 * Put loot in a dungeon: a hoard in the lair (the exit room, else the room
 * farthest from the entrance) and caches in some other rooms. Never in the entrance room.
 */
export function stockDungeon(map: DungeonMap, rng: Rng, items: ItemDef[], partyLevel: number, used: Set<string> = new Set(), cacheChance = 0.35): LootObject[] {
  const tier = tierForLevel(partyLevel);
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
  if (rooms.length === 0) return [];
  const exit = map.objects.find((o) => o.kind === 'stairs' && o.role === 'exit');
  const inRoom = (p: Point, r: RoomObject) => p.x >= r.rect.x && p.y >= r.rect.y && p.x < r.rect.x + r.rect.w && p.y < r.rect.y + r.rect.h;
  const lair = (exit && exit.kind === 'stairs' && rooms.find((r) => inRoom(exit.at, r))) || rooms[rooms.length - 1];
  const entrance = rooms[0];

  const taken = new Set<number>();
  const out: LootObject[] = [];
  let n = 0;
  const place = (room: RoomObject, kind: LootKind) => {
    const at = freeSpotInRoom(map, room, rng, taken);
    if (!at) return;
    taken.add(idx(map, at.x, at.y));
    out.push({
      id: `loot-${++n}-${rng.int(0, 1e6).toString(36)}`,
      kind: 'loot',
      at,
      container: 'chest',
      items: rollLoot(rng, tier, kind, items, used),
      label: kind === 'hoard' ? `Hoard (${room.label ?? 'lair'})` : `Chest (${room.label ?? 'room'})`,
      visibility: 'public',
    });
  };
  if (lair !== entrance) place(lair, 'hoard');
  for (const r of rooms) if (r !== lair && r !== entrance && rng.chance(cacheChance)) place(r, 'cache');
  return out;
}
