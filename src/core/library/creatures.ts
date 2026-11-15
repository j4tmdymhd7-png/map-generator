/**
 * The creature library: stat templates the DM can edit, used to spawn
 * monsters and to fill random encounters. Starter entries are generic
 * placeholders with made-up numbers; replace them with real stat blocks.
 */
import type { Behavior, Size, StatBlock, Token } from '../model/types';

export interface CreatureTemplate {
  id: string;
  name: string;
  size: Size;
  speed: number;
  stats: StatBlock;
  initiativeBonus?: number;
  behavior: Behavior;
  /** Appears in random encounters. */
  encounters: boolean;
  groupMin: number;
  groupMax: number;
  /** Relative odds among encounter-eligible creatures. */
  weight: number;
  /** Rolls pocket loot when spawned. */
  carriesLoot: boolean;
}

const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });

export const STARTER_CREATURES: CreatureTemplate[] = [
  {
    id: 'grunt',
    name: 'Grunt',
    size: 'medium',
    speed: 30,
    stats: { ac: 13, hp: 11, maxHp: 11, abilities: ab(13, 12, 12, 8, 10, 8), cr: '1/4', actions: 'Placeholder. Melee attack: +3 to hit, 1d8+1 damage.' },
    behavior: 'wander',
    encounters: true,
    groupMin: 2,
    groupMax: 4,
    weight: 3,
    carriesLoot: true,
  },
  {
    id: 'skulker',
    name: 'Skulker',
    size: 'small',
    speed: 30,
    stats: { ac: 13, hp: 7, maxHp: 7, abilities: ab(8, 14, 10, 10, 8, 8), cr: '1/4', actions: 'Placeholder. Shortbow: +4 to hit, range 80/320, 1d6+2 damage.' },
    behavior: 'wander',
    encounters: true,
    groupMin: 2,
    groupMax: 5,
    weight: 2,
    carriesLoot: true,
  },
  {
    id: 'brute',
    name: 'Brute',
    size: 'large',
    speed: 40,
    stats: { ac: 11, hp: 59, maxHp: 59, abilities: ab(19, 8, 16, 5, 7, 7), cr: '2', actions: 'Placeholder. Slam: +6 to hit, 2d8+4 damage.' },
    behavior: 'wander',
    encounters: true,
    groupMin: 1,
    groupMax: 1,
    weight: 1,
    carriesLoot: false,
  },
  {
    id: 'lurker',
    name: 'Lurker',
    size: 'medium',
    speed: 20,
    stats: { ac: 12, hp: 22, maxHp: 22, abilities: ab(14, 10, 14, 3, 10, 5), cr: '1/2', actions: 'Placeholder. Grasping bite: +4 to hit, 1d10+2 damage; target is grappled.' },
    behavior: 'wander',
    encounters: true,
    groupMin: 1,
    groupMax: 2,
    weight: 1,
    carriesLoot: false,
  },
  {
    id: 'ogre',
    name: 'Ogre',
    size: 'large',
    speed: 40,
    stats: { ac: 11, hp: 68, maxHp: 68, abilities: ab(19, 8, 16, 5, 7, 7), cr: '2', actions: 'Placeholder stats: replace with your stat block.' },
    initiativeBonus: -1,
    behavior: 'guard',
    encounters: false,
    groupMin: 1,
    groupMax: 1,
    weight: 1,
    carriesLoot: true,
  },
  {
    id: 'goblin-boss',
    name: 'Goblin Boss',
    size: 'small',
    speed: 30,
    stats: { ac: 17, hp: 21, maxHp: 21, abilities: ab(10, 15, 10, 10, 8, 10), cr: '1', actions: 'Placeholder stats: replace with your stat block.' },
    initiativeBonus: 2,
    behavior: 'guard',
    encounters: false,
    groupMin: 1,
    groupMax: 1,
    weight: 1,
    carriesLoot: true,
  },
];

/** A fresh enemy token from a template (position is set by placement). */
export function tokenFromTemplate(t: CreatureTemplate, id: string, mapId: string, label = t.name): Token {
  return {
    id,
    mapId,
    label,
    color: '#8a8a8a',
    size: t.size,
    position: { x: 0, y: 0 },
    speeds: { walk: t.speed },
    senses: {},
    side: 'enemy',
    conditions: [],
    visibility: 'public',
    initiativeBonus: t.initiativeBonus,
    behavior: t.behavior,
    leash: t.behavior === 'guard' ? 6 : undefined,
    stats: { ...t.stats, abilities: { ...t.stats.abilities }, hp: t.stats.maxHp },
    templateId: t.id,
  };
}
