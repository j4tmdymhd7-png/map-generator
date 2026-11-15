/**
 * Rules-agnostic movement search over a MoveGrid.
 *
 * Dijkstra over states (x, y, diagonalParity). Parity only matters for the
 * alternating-diagonal variant but is always tracked so both policies share
 * one code path.
 */
import type { Point } from '../model/types';
import type { MoveGrid } from './dnd2024';

export interface PathStep extends Point {
  /** Feet spent entering this square. */
  cost: number;
  /** Cumulative feet after this step. */
  total: number;
  diagonal: boolean;
  difficult: boolean;
}

export interface PathResult {
  steps: PathStep[];
  totalFeet: number;
  /** Destination is legal to end on and within any budget given. */
  legal: boolean;
  /** Why it isn't legal (empty when legal). */
  reasons: string[];
  /** Legal-but-notable things the DM should see (e.g. pit destination). */
  warnings: string[];
}

export interface Reach {
  grid: MoveGrid;
  size: number; // footprint side length
  start: Point;
  budget: number;
  /** Best cost per state index (cell*2 + parity); Infinity if unreached. */
  dist: Float64Array;
  /** Previous state index, -1 for start/unreached. */
  prev: Int32Array;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys,
      v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.keys,
      v = this.vals;
    const topK = k[0],
      topV = v[0];
    const lastK = k.pop()!,
      lastV = v.pop()!;
    if (k.length > 0) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [topK, topV];
  }
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function footprintAny(g: MoveGrid, x: number, y: number, s: number, layer: Uint8Array): boolean {
  for (let dy = 0; dy < s; dy++)
    for (let dx = 0; dx < s; dx++) if (layer[(y + dy) * g.width + (x + dx)]) return true;
  return false;
}

function footprintFits(g: MoveGrid, x: number, y: number, s: number): boolean {
  if (x < 0 || y < 0 || x + s > g.width || y + s > g.height) return false;
  return !footprintAny(g, x, y, s, g.blocked);
}

/** Squares newly entered when stepping a footprint by (dx, dy). */
function enteredSquaresDifficult(g: MoveGrid, x: number, y: number, dx: number, dy: number, s: number): boolean {
  const nx = x + dx,
    ny = y + dy;
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const cx = nx + i,
        cy = ny + j;
      const wasInside = cx >= x && cx < x + s && cy >= y && cy < y + s;
      if (!wasInside && g.difficult[cy * g.width + cx]) return true;
    }
  }
  return false;
}

/** The two squares a diagonal step sweeps past but never occupies. */
function diagonalCutsCorner(g: MoveGrid, x: number, y: number, dx: number, dy: number, s: number): boolean {
  const leadX = dx > 0 ? x + s : x - 1;
  const trailX = dx > 0 ? x : x + s - 1;
  const leadY = dy > 0 ? y + s : y - 1;
  const trailY = dy > 0 ? y : y + s - 1;
  const solidAt = (cx: number, cy: number) =>
    cx < 0 || cy < 0 || cx >= g.width || cy >= g.height || g.solid[cy * g.width + cx] === 1;
  // The rest of the leading edge is inside the new footprint and checked by footprintFits.
  return solidAt(leadX, trailY) || solidAt(trailX, leadY);
}

export function canEndAt(g: MoveGrid, x: number, y: number, s: number): boolean {
  return footprintFits(g, x, y, s) && !footprintAny(g, x, y, s, g.noEnd);
}

/**
 * Compute every reachable footprint position from `start`.
 * `budget` caps the search (feet); pass Infinity to price any destination.
 */
export function computeReach(g: MoveGrid, start: Point, size: number, budget = Infinity): Reach {
  const cells = g.width * g.height;
  const dist = new Float64Array(cells * 2).fill(Infinity);
  const prev = new Int32Array(cells * 2).fill(-1);
  const reach: Reach = { grid: g, size, start, budget, dist, prev };
  if (start.x < 0 || start.y < 0 || start.x + size > g.width || start.y + size > g.height) return reach;

  const startState = (start.y * g.width + start.x) * 2;
  dist[startState] = 0;
  const heap = new MinHeap();
  heap.push(0, startState);
  const base = g.cellFeet;

  while (heap.size > 0) {
    const [d, state] = heap.pop();
    if (d > dist[state]) continue;
    const cell = state >> 1;
    const parity = state & 1;
    const x = cell % g.width;
    const y = (cell - x) / g.width;
    // Never route *through* a hazard (but it can be a destination).
    if (state !== startState && footprintAny(g, x, y, size, g.hazard)) continue;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx,
        ny = y + dy;
      if (!footprintFits(g, nx, ny, size)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && diagonalCutsCorner(g, x, y, dx, dy, size)) continue;

      let step = base;
      let nParity = parity;
      if (diagonal && g.policy.diagonal === 'alternating') {
        step = parity === 0 ? base : base * 2;
        nParity = parity ^ 1;
      }
      if (enteredSquaresDifficult(g, x, y, dx, dy, size)) step *= 2;

      const nd = d + step;
      if (nd > budget) continue;
      const ns = (ny * g.width + nx) * 2 + nParity;
      if (nd < dist[ns]) {
        dist[ns] = nd;
        prev[ns] = state;
        heap.push(nd, ns);
      }
    }
  }
  return reach;
}

function bestState(reach: Reach, x: number, y: number): number {
  const c = (y * reach.grid.width + x) * 2;
  return reach.dist[c] <= reach.dist[c + 1] ? c : c + 1;
}

/** Cheapest cost (feet) to reach a footprint position, or Infinity. */
export function costTo(reach: Reach, p: Point): number {
  const g = reach.grid;
  if (p.x < 0 || p.y < 0 || p.x >= g.width || p.y >= g.height) return Infinity;
  return reach.dist[bestState(reach, p.x, p.y)];
}

/** Positions the mover could legally end on within the reach budget. */
export function reachableDestinations(reach: Reach): Point[] {
  const g = reach.grid;
  const out: Point[] = [];
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      if (x === reach.start.x && y === reach.start.y) continue;
      if (costTo(reach, { x, y }) <= reach.budget && canEndAt(g, x, y, reach.size)) out.push({ x, y });
    }
  return out;
}

export function pathTo(reach: Reach, target: Point, budget = reach.budget): PathResult {
  const g = reach.grid;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const inMap = target.x >= 0 && target.y >= 0 && target.x < g.width && target.y < g.height;
  const cost = inMap ? costTo(reach, target) : Infinity;

  if (!Number.isFinite(cost)) {
    return { steps: [], totalFeet: Infinity, legal: false, reasons: ['No path: blocked by walls, doors or creatures.'], warnings };
  }

  const states: number[] = [];
  for (let s = bestState(reach, target.x, target.y); s !== -1; s = reach.prev[s]) states.push(s);
  states.reverse();

  const steps: PathStep[] = [];
  for (let i = 1; i < states.length; i++) {
    const a = states[i - 1] >> 1,
      b = states[i] >> 1;
    const ax = a % g.width,
      ay = (a - ax) / g.width;
    const bx = b % g.width,
      by = (b - bx) / g.width;
    const total = reach.dist[states[i]];
    const prevTotal = reach.dist[states[i - 1]];
    steps.push({
      x: bx,
      y: by,
      cost: total - prevTotal,
      total,
      diagonal: ax !== bx && ay !== by,
      difficult: enteredSquaresDifficult(g, ax, ay, bx - ax, by - ay, reach.size),
    });
  }

  if (cost > budget) reasons.push(`Needs ${cost} ft; only ${budget} ft of movement left.`);
  if (footprintAny(g, target.x, target.y, reach.size, g.noEnd)) reasons.push(`Can't end a move in another creature's space.`);
  if (footprintAny(g, target.x, target.y, reach.size, g.hazard)) warnings.push('Destination is a pit or hazard.');

  return { steps, totalFeet: cost, legal: reasons.length === 0, reasons, warnings };
}
