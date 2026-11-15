/**
 * Unseen creatures drifting around the dungeon between rounds.
 *
 * Rules of the road:
 * - Only creatures the party can't currently see move, and they only move
 *   through squares the party can't see, so wandering never reveals itself.
 * - They don't open doors (closed doors block them), so a door never swings
 *   open on its own in front of the players.
 * - Guards stay within their leash of home; 'still' creatures don't move.
 * - Movement uses the same 2024 movement rules and speed as everyone else.
 * The DM moves anything the party can see.
 */
import type { Behavior, DungeonMap, GridPolicy, Point, Token } from '../model/types';
import { idx } from '../model/grid';
import { buildMoveGrid, footprintSquares } from '../rules/dnd2024';
import { computeReach, costTo, reachableDestinations } from '../rules/pathfinding';
import type { Rng } from '../rng';

export interface WanderOptions {
  policy: GridPolicy;
  /** Chance each eligible creature moves this round. */
  moveChance: number;
  /** Leash for guards without one set. */
  defaultLeash: number;
}

export const DEFAULT_WANDER: WanderOptions = {
  policy: { diagonal: 'uniform', closedDoors: 'block' },
  moveChance: 0.6,
  defaultLeash: 6,
};

export function behaviorOf(t: Token): Behavior {
  return t.behavior ?? (t.side === 'party' ? 'still' : 'wander');
}

function coveredSquares(map: DungeonMap, t: Token, p: Point): number[] {
  const s = footprintSquares(t.size);
  const out: number[] = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push(idx(map, p.x + dx, p.y + dy));
  return out;
}

/** Where (if anywhere) an unseen creature wanders this round. */
export function planWander(
  map: DungeonMap,
  tokens: Token[],
  mover: Token,
  visible: Uint8Array,
  rng: Rng,
  opts: WanderOptions = DEFAULT_WANDER,
): Point | null {
  const behavior = behaviorOf(mover);
  if (behavior === 'still' || mover.side === 'party' || mover.mapId !== map.id) return null;
  if (coveredSquares(map, mover, mover.position).some((i) => visible[i])) return null; // the party is watching
  if (!rng.chance(opts.moveChance)) return null;

  const grid = buildMoveGrid(map, mover, tokens, { ...opts.policy, closedDoors: 'block' });
  for (let i = 0; i < visible.length; i++) if (visible[i]) grid.blocked[i] = 1; // never cross the party's sight
  const size = footprintSquares(mover.size);
  const reach = computeReach(grid, mover.position, size, mover.speeds.walk);

  const home = mover.home ?? mover.position;
  const leash = mover.leash ?? opts.defaultLeash;
  const candidates = reachableDestinations(reach).filter((p) => {
    if (behavior === 'guard' && Math.max(Math.abs(p.x - home.x), Math.abs(p.y - home.y)) > leash) return false;
    return coveredSquares(map, mover, p).every((i) => map.terrain[i] === 'floor' || map.terrain[i] === 'stairs');
  });
  if (candidates.length === 0) return null;
  // Prefer actually going somewhere over shuffling a square.
  const far = candidates.filter((p) => costTo(reach, p) >= mover.speeds.walk / 2);
  return rng.pick(far.length ? far : candidates);
}

/** Move every eligible unseen creature, one after another so they don't collide. */
export function wanderAll(
  map: DungeonMap,
  tokens: Token[],
  visible: Uint8Array,
  rng: Rng,
  opts: WanderOptions = DEFAULT_WANDER,
): { tokens: Token[]; moved: Token[] } {
  let current = tokens;
  const moved: Token[] = [];
  for (const t of tokens) {
    const self = current.find((c) => c.id === t.id)!;
    const dest = planWander(map, current, self, visible, rng, opts);
    if (!dest) continue;
    const next = { ...self, position: dest };
    current = current.map((c) => (c.id === t.id ? next : c));
    moved.push(next);
  }
  return { tokens: current, moved };
}
