import type { Ability, StatBlock, Token } from './model/types';

/** 2024 ability modifier: floor((score - 10) / 2). */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatMod(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

export const ABILITY_LABEL: Record<Ability, string> = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

/** The 2024 conditions, with short badges for the map. */
export const CONDITIONS: { name: string; badge: string }[] = [
  { name: 'blinded', badge: 'BLD' },
  { name: 'charmed', badge: 'CHM' },
  { name: 'deafened', badge: 'DEF' },
  { name: 'exhaustion', badge: 'EXH' },
  { name: 'frightened', badge: 'FRT' },
  { name: 'grappled', badge: 'GRP' },
  { name: 'incapacitated', badge: 'INC' },
  { name: 'invisible', badge: 'INV' },
  { name: 'paralyzed', badge: 'PAR' },
  { name: 'petrified', badge: 'PET' },
  { name: 'poisoned', badge: 'PSN' },
  { name: 'prone', badge: 'PRN' },
  { name: 'restrained', badge: 'RST' },
  { name: 'stunned', badge: 'STN' },
  { name: 'unconscious', badge: 'UNC' },
];

export function defaultStats(): StatBlock {
  return { ac: 10, hp: 10, maxHp: 10, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
}

/** Explicit initiative bonus if set, else the DEX modifier, else 0. */
export function initiativeBonusOf(t: Token): number {
  if (t.initiativeBonus !== undefined) return t.initiativeBonus;
  return t.stats ? abilityMod(t.stats.abilities.dex) : 0;
}

/** Apply damage (temp HP first) or healing (capped at max). Negative amount = healing. */
export function applyHp(stats: StatBlock, amount: number): StatBlock {
  if (amount < 0) return { ...stats, hp: Math.min(stats.maxHp, stats.hp - amount) };
  const temp = stats.tempHp ?? 0;
  const fromTemp = Math.min(temp, amount);
  return { ...stats, tempHp: temp - fromTemp || undefined, hp: Math.max(0, stats.hp - (amount - fromTemp)) };
}
