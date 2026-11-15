import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { asciiMap, token } from '../rules/test-helpers';
import { rollInitiative } from './initiative';
import { planWander, wanderAll } from './wander';

const always = { policy: { diagonal: 'uniform' as const, closedDoors: 'block' as const }, moveChance: 1, defaultLeash: 6 };

const HALL = ['####################', '#..................#', '#..................#', '####################'];

describe('wandering monsters', () => {
  it('moves an unseen monster within its speed, never into squares the party can see', () => {
    const map = asciiMap(HALL);
    const visible = new Uint8Array(map.width * map.height);
    for (let x = 1; x <= 6; x++) visible[1 * map.width + x] = visible[2 * map.width + x] = 1;
    const m = token({ side: 'enemy', position: { x: 15, y: 1 }, speeds: { walk: 30 } });
    for (let i = 0; i < 30; i++) {
      const p = planWander(map, [m], m, visible, createRng(`w${i}`), always)!;
      expect(p).not.toBeNull();
      expect(p.x).toBeGreaterThan(6);
      expect(Math.max(Math.abs(p.x - 15), Math.abs(p.y - 1))).toBeLessThanOrEqual(6);
    }
  });

  it("doesn't move a monster the party can see", () => {
    const map = asciiMap(HALL);
    const visible = new Uint8Array(map.width * map.height).fill(1);
    const m = token({ side: 'enemy', position: { x: 15, y: 1 } });
    expect(planWander(map, [m], m, visible, createRng('x'), always)).toBeNull();
  });

  it('keeps guards on their leash and leaves still creatures alone', () => {
    const map = asciiMap(HALL);
    const visible = new Uint8Array(map.width * map.height);
    const boss = token({ side: 'enemy', position: { x: 10, y: 1 }, speeds: { walk: 40 }, behavior: 'guard', home: { x: 10, y: 1 }, leash: 2 });
    for (let i = 0; i < 30; i++) {
      const p = planWander(map, [boss], boss, visible, createRng(`g${i}`), always)!;
      expect(Math.abs(p.x - 10)).toBeLessThanOrEqual(2);
    }
    const statue = token({ side: 'enemy', position: { x: 3, y: 1 }, behavior: 'still' });
    expect(planWander(map, [statue], statue, visible, createRng('s'), always)).toBeNull();
  });

  it("won't open a closed door", () => {
    const map = asciiMap(['#####', '#.+.#', '#####']);
    const m = token({ side: 'enemy', position: { x: 1, y: 1 } });
    expect(planWander(map, [m], m, new Uint8Array(15), createRng('d'), always)).toBeNull();
  });

  it('moves several monsters without stacking them on one square', () => {
    const map = asciiMap(['#####', '#...#', '#####']);
    const a = token({ side: 'enemy', position: { x: 1, y: 1 } });
    const b = token({ side: 'enemy', position: { x: 3, y: 1 } });
    for (let i = 0; i < 20; i++) {
      const { tokens } = wanderAll(map, [a, b], new Uint8Array(15), createRng(`m${i}`), always);
      const [pa, pb] = tokens.map((t) => `${t.position.x},${t.position.y}`);
      expect(pa).not.toBe(pb);
    }
  });
});

describe('initiative', () => {
  it('orders by total, then bonus', () => {
    const fast = token({ initiativeBonus: 30 });
    const slow = token({ initiativeBonus: -30 });
    const order = rollInitiative([slow, fast], createRng('i'));
    expect(order.map((e) => e.tokenId)).toEqual([fast.id, slow.id]);
    for (const e of order) expect(e.roll).toBeGreaterThanOrEqual(1);
  });
});
