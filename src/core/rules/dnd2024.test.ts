import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_POLICY, type GridPolicy } from '../model/types';
import { buildMoveGrid, canPassThrough, footprintSquares, rangeFeet } from './dnd2024';
import { computeReach, costTo, pathTo, reachableDestinations } from './pathfinding';
import { asciiMap, token } from './test-helpers';

const uniform = DEFAULT_GRID_POLICY;
const alternating: GridPolicy = { ...DEFAULT_GRID_POLICY, diagonal: 'alternating' };

function reachFor(rows: string[], mover = token(), others: ReturnType<typeof token>[] = [], policy = uniform, budget = Infinity) {
  const map = asciiMap(rows);
  const grid = buildMoveGrid(map, mover, [mover, ...others], policy);
  return computeReach(grid, mover.position, footprintSquares(mover.size), budget);
}

const OPEN_ROOM = ['..........', '..........', '..........', '..........', '..........', '..........', '..........', '..........'];

describe('2024 movement costs', () => {
  it('charges 5 ft per square, diagonals included (uniform)', () => {
    const r = reachFor(OPEN_ROOM);
    expect(costTo(r, { x: 3, y: 0 })).toBe(15);
    expect(costTo(r, { x: 3, y: 3 })).toBe(15);
  });

  it('alternates 5/10 on diagonals under the variant rule', () => {
    const r = reachFor(OPEN_ROOM, token(), [], alternating);
    expect(costTo(r, { x: 1, y: 1 })).toBe(5);
    expect(costTo(r, { x: 2, y: 2 })).toBe(15);
    expect(costTo(r, { x: 3, y: 3 })).toBe(20);
    expect(costTo(r, { x: 5, y: 2 })).toBe(30); // 2 diagonals (5 + 10) + 3 straight (15)
  });

  it('a 30 ft speed covers 6 squares', () => {
    const r = reachFor(OPEN_ROOM, token(), [], uniform, 30);
    expect(costTo(r, { x: 6, y: 0 })).toBe(30);
    expect(costTo(r, { x: 7, y: 0 })).toBe(Infinity);
  });

  it('difficult terrain doubles the cost of entering a square', () => {
    const r = reachFor(['.~~.', '####']);
    expect(costTo(r, { x: 1, y: 0 })).toBe(10);
    expect(costTo(r, { x: 3, y: 0 })).toBe(25);
    const path = pathTo(r, { x: 3, y: 0 });
    expect(path.steps.map((s) => s.difficult)).toEqual([true, true, false]);
  });

  it('routes around difficult terrain when cheaper', () => {
    const r = reachFor(['.~.', '...']);
    expect(costTo(r, { x: 2, y: 0 })).toBe(10); // diagonal down, diagonal up
  });
});

describe('walls, corners and doors', () => {
  it('blocks walls and void', () => {
    const r = reachFor(['.#.', '.#.', '.#.']);
    expect(costTo(r, { x: 2, y: 0 })).toBe(Infinity);
    expect(pathTo(r, { x: 2, y: 0 }).legal).toBe(false);
  });

  it("doesn't let a diagonal cut a wall corner", () => {
    // Moving from (0,1) to (1,0) would clip the wall at (0,0)
    const mover = token({ position: { x: 0, y: 1 } });
    const r = reachFor(['#.', '..'], mover);
    expect(costTo(r, { x: 1, y: 0 })).toBe(10); // must go right then up
  });

  it('closed doors block by default, open doors pass, locked always blocks', () => {
    const at = () => token({ position: { x: 0, y: 1 } });
    const passable: GridPolicy = { ...uniform, closedDoors: 'passable' };
    expect(costTo(reachFor(['###', '.+.', '###'], at()), { x: 2, y: 1 })).toBe(Infinity);
    expect(costTo(reachFor(['###', './.', '###'], at()), { x: 2, y: 1 })).toBe(10);
    expect(costTo(reachFor(['###', '.+.', '###'], at(), [], passable), { x: 2, y: 1 })).toBe(10);
    expect(costTo(reachFor(['###', '.L.', '###'], at(), [], passable), { x: 2, y: 1 })).toBe(Infinity);
  });

  it('never routes through a pit but allows it as a destination with a warning', () => {
    const r = reachFor(['.O.', '###']);
    expect(costTo(r, { x: 2, y: 0 })).toBe(Infinity);
    const p = pathTo(r, { x: 1, y: 0 });
    expect(p.legal).toBe(true);
    expect(p.warnings).toHaveLength(1);
  });
});

describe('creatures', () => {
  it('passes through allies but cannot end in their space', () => {
    const mover = token({ position: { x: 0, y: 0 } });
    const ally = token({ position: { x: 1, y: 0 }, side: 'party' });
    const r = reachFor(['...', '###'], mover, [ally]);
    expect(costTo(r, { x: 2, y: 0 })).toBe(10); // ally space is not difficult
    const p = pathTo(r, { x: 1, y: 0 });
    expect(p.legal).toBe(false);
  });

  it('cannot pass a same-size enemy', () => {
    const mover = token({ position: { x: 0, y: 0 } });
    const enemy = token({ position: { x: 1, y: 0 }, side: 'enemy' });
    const r = reachFor(['...', '###'], mover, [enemy]);
    expect(costTo(r, { x: 2, y: 0 })).toBe(Infinity);
  });

  it('can pass an enemy two sizes different, at difficult-terrain cost', () => {
    const mover = token({ position: { x: 0, y: 0 } });
    const huge = token({ size: 'huge', side: 'enemy' });
    expect(canPassThrough(mover, huge)).toBe(true);
    const smallEnemy = token({ position: { x: 1, y: 0 }, side: 'enemy', size: 'tiny' });
    const r = reachFor(['...', '###'], mover, [smallEnemy]);
    expect(costTo(r, { x: 2, y: 0 })).toBe(10); // Tiny: not difficult
    const incap = token({ position: { x: 1, y: 0 }, side: 'enemy', conditions: ['incapacitated'] });
    expect(costTo(reachFor(['...', '###'], mover, [incap]), { x: 2, y: 0 })).toBe(15); // difficult
  });

  it('Large creatures need a 2x2 path', () => {
    const big = token({ size: 'large', position: { x: 0, y: 0 } });
    // 1-wide gap at the right: a Medium could get through, Large cannot
    const rows = ['.....', '.....', '###.#', '.....', '.....'];
    expect(costTo(reachFor(rows, big), { x: 0, y: 3 })).toBe(Infinity);
    expect(costTo(reachFor(rows), { x: 0, y: 3 })).toBeLessThan(Infinity);
  });

  it('lists legal destinations within budget', () => {
    const r = reachFor(['....', '....'], token(), [], uniform, 5);
    expect(reachableDestinations(r)).toHaveLength(3);
  });
});

describe('range', () => {
  it('counts from an adjacent square to the other space', () => {
    const a = { position: { x: 0, y: 0 }, size: 'medium' as const };
    expect(rangeFeet(a, { position: { x: 1, y: 0 }, size: 'medium' }, uniform)).toBe(5);
    expect(rangeFeet(a, { position: { x: 4, y: 4 }, size: 'medium' }, uniform)).toBe(20);
    expect(rangeFeet(a, { position: { x: 4, y: 4 }, size: 'medium' }, alternating)).toBe(30);
    expect(rangeFeet(a, { position: { x: 2, y: 0 }, size: 'large' }, uniform)).toBe(10);
  });
});
