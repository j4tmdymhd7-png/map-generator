/** Initiative: d20 + bonus, highest first. */
import type { Token } from '../model/types';
import type { Rng } from '../rng';

export interface InitiativeEntry {
  tokenId: string;
  roll: number;
  bonus: number;
  total: number;
  /** Random tiebreaker so equal totals don't always resolve the same way. */
  tiebreak: number;
}

export function rollInitiative(tokens: Token[], rng: Rng): InitiativeEntry[] {
  return sortInitiative(
    tokens.map((t) => {
      const roll = rng.int(1, 20);
      const bonus = t.initiativeBonus ?? 0;
      return { tokenId: t.id, roll, bonus, total: roll + bonus, tiebreak: rng.next() };
    }),
  );
}

/** Highest total first; ties go to the higher bonus, then the tiebreaker. */
export function sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => b.total - a.total || b.bonus - a.bonus || b.tiebreak - a.tiebreak);
}
