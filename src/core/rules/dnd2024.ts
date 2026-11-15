/**
 * D&D 2024 rules adapter (reference: SRD 5.2.1, CC-BY-4.0).
 *
 * Builds a per-mover "move grid" that the generic pathfinder consumes. All
 * rules knowledge lives here; the pathfinder only knows about costs and flags.
 *
 * Everything this module decides is advisory: the DM can always override.
 */
import { idx, inBounds } from '../model/grid';
import type { DoorState, DungeonMap, GridPolicy, Size, Token } from '../model/types';

export const RULESET_ID = 'dnd-2024/srd-5.2.1';

const SIZE_ORDER: Record<Size, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gargantuan: 5,
};

/** Side length of a creature's footprint in squares (Tiny shares one square). */
export function footprintSquares(size: Size): number {
  switch (size) {
    case 'tiny':
    case 'small':
    case 'medium':
      return 1;
    case 'large':
      return 2;
    case 'huge':
      return 3;
    case 'gargantuan':
      return 4;
  }
}

export function isAlly(a: Token, b: Token): boolean {
  return a.side === b.side && a.side !== 'neutral';
}

/**
 * 2024 "Moving around Other Creatures": you can pass through the space of an
 * ally, an Incapacitated creature, a Tiny creature, or a creature two sizes
 * larger or smaller than you.
 */
export function canPassThrough(mover: Token, other: Token): boolean {
  if (isAlly(mover, other)) return true;
  if (other.size === 'tiny') return true;
  if (other.conditions.includes('incapacitated')) return true;
  return Math.abs(SIZE_ORDER[mover.size] - SIZE_ORDER[other.size]) >= 2;
}

/** Another creature's space is Difficult Terrain unless it is Tiny or your ally. */
export function occupiedSpaceIsDifficult(mover: Token, other: Token): boolean {
  return !(other.size === 'tiny' || isAlly(mover, other));
}

/** Per-cell movement facts for one specific mover. */
export interface MoveGrid {
  width: number;
  height: number;
  /** Feet per square. */
  cellFeet: number;
  policy: GridPolicy;
  /** Cannot be entered at all. */
  blocked: Uint8Array;
  /** Fills its space: diagonal movement can't cut its corner. */
  solid: Uint8Array;
  /** Costs extra movement to enter. */
  difficult: Uint8Array;
  /** Occupied by another creature: may pass, can't end here. */
  noEnd: Uint8Array;
  /** Pit/hazard: allowed as a destination (with a warning), never routed through. */
  hazard: Uint8Array;
}

export function doorStates(map: DungeonMap): Map<number, DoorState> {
  const out = new Map<number, DoorState>();
  for (const o of map.objects) {
    if (o.kind === 'door' && inBounds(map, o.at.x, o.at.y)) out.set(idx(map, o.at.x, o.at.y), o.state);
  }
  return out;
}

export function buildMoveGrid(map: DungeonMap, mover: Token, tokens: Token[], policy: GridPolicy): MoveGrid {
  const n = map.width * map.height;
  const g: MoveGrid = {
    width: map.width,
    height: map.height,
    cellFeet: map.cellSizeFeet,
    policy,
    blocked: new Uint8Array(n),
    solid: new Uint8Array(n),
    difficult: new Uint8Array(n),
    noEnd: new Uint8Array(n),
    hazard: new Uint8Array(n),
  };
  const doors = doorStates(map);

  for (let i = 0; i < n; i++) {
    const t = map.terrain[i];
    if ((map.flags[i] & 1) !== 0) g.difficult[i] = 1;
    switch (t) {
      case 'void':
      case 'wall':
      case 'obstacle':
        g.blocked[i] = 1;
        g.solid[i] = 1;
        break;
      case 'door': {
        // A door cell with no door object is treated as closed.
        const state = doors.get(i) ?? 'closed';
        if (state !== 'open') g.solid[i] = 1;
        if (state === 'locked' || (state === 'closed' && policy.closedDoors === 'block')) g.blocked[i] = 1;
        break;
      }
      case 'pit':
      case 'hazard':
        g.hazard[i] = 1;
        break;
      case 'floor':
      case 'stairs':
        break;
    }
  }

  for (const other of tokens) {
    if (other.id === mover.id || other.mapId !== map.id) continue;
    const s = footprintSquares(other.size);
    const pass = canPassThrough(mover, other);
    const diff = occupiedSpaceIsDifficult(mover, other);
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const x = other.position.x + dx;
        const y = other.position.y + dy;
        if (!inBounds(map, x, y)) continue;
        const i = idx(map, x, y);
        g.noEnd[i] = 1;
        if (!pass) g.blocked[i] = 1;
        else if (diff) g.difficult[i] = 1;
      }
    }
  }
  return g;
}

/** Human-readable assumptions, shown next to every movement preview. */
export function describeAssumptions(policy: GridPolicy, cellFeet = 5): string[] {
  return [
    `Rules: D&D 2024 (SRD 5.2.1). Advisory only — the DM decides.`,
    `Each square is ${cellFeet} ft.`,
    policy.diagonal === 'uniform'
      ? `Diagonal squares cost the same as orthogonal ones (2024 default).`
      : `Diagonals alternate ${cellFeet}/${cellFeet * 2} ft (optional variant rule).`,
    `Difficult Terrain doubles the cost of entering a square.`,
    `Diagonal moves can't cut the corner of a wall, obstacle or closed door.`,
    `You can pass through allies, Tiny or Incapacitated creatures, or creatures two sizes larger/smaller; non-ally, non-Tiny spaces are Difficult Terrain; you can't end in an occupied space.`,
    policy.closedDoors === 'block'
      ? `Closed doors block the path until opened; locked doors always block.`
      : `Closed doors are treated as passable; locked doors always block.`,
    `Paths never route through pits or hazards, but you can choose one as a destination.`,
    `Large and bigger creatures pay extra if any newly entered square of their space is difficult.`,
  ];
}

/**
 * Distance in feet between two footprints, counted from a square adjacent to
 * one to the space of the other (2024 "Ranges" on a grid).
 */
export function rangeFeet(
  a: { position: { x: number; y: number }; size: Size },
  b: { position: { x: number; y: number }; size: Size },
  policy: GridPolicy,
  cellFeet = 5,
): number {
  const an = footprintSquares(a.size);
  const bn = footprintSquares(b.size);
  const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1);
  const dx = gap(a.position.x, a.position.x + an - 1, b.position.x, b.position.x + bn - 1);
  const dy = gap(a.position.y, a.position.y + an - 1, b.position.y, b.position.y + bn - 1);
  const long = Math.max(dx, dy);
  const short = Math.min(dx, dy);
  const squares = policy.diagonal === 'uniform' ? long : long + Math.floor(short / 2);
  return squares * cellFeet;
}
