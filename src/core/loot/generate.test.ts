import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../generator/generate';
import { createRng } from '../rng';
import { abilityMod, applyHp, defaultStats, initiativeBonusOf } from '../stats';
import { token } from '../rules/test-helpers';
import { STARTER_ITEMS, type ItemDef } from './items';
import { lootValueGp, rollLoot, stockDungeon, tierForLevel } from './generate';

describe('loot', () => {
  it('scales with party tier', () => {
    const avg = (tier: 1 | 2 | 3 | 4) => {
      let total = 0;
      for (let i = 0; i < 200; i++) total += lootValueGp(rollLoot(createRng(`t${tier}-${i}`), tier, 'hoard', STARTER_ITEMS).filter((s) => s.category === 'coins'));
      return total / 200;
    };
    expect(avg(2)).toBeGreaterThan(avg(1) * 3);
    expect(avg(4)).toBeGreaterThan(avg(3) * 2);
    expect([1, 4, 5, 10, 11, 16, 17, 20].map(tierForLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('keeps magic items within the tier: no legendary loot for a level-3 party', () => {
    for (let i = 0; i < 400; i++) {
      for (const kind of ['pocket', 'cache', 'hoard'] as const) {
        const loot = rollLoot(createRng(`r${i}${kind}`), 1, kind, STARTER_ITEMS);
        for (const s of loot) if (s.category === 'magic') expect(['common', 'uncommon', 'rare'], s.name).toContain(s.rarity);
      }
    }
  });

  it('never rolls DM-only items, and hands out uniques at most once', () => {
    const special: ItemDef[] = [
      { id: 'crown-of-x', name: 'Crown of the Drowned King', category: 'quest', random: true, unique: true },
      { id: 'letter', name: 'Sealed letter', category: 'quest', random: false, unique: true },
    ];
    const items = [...STARTER_ITEMS, ...special];
    const used = new Set<string>();
    let crowns = 0;
    for (let i = 0; i < 300; i++) {
      const loot = rollLoot(createRng(`u${i}`), 2, 'hoard', items, used);
      expect(loot.some((s) => s.defId === 'letter')).toBe(false);
      crowns += loot.filter((s) => s.defId === 'crown-of-x').length;
    }
    expect(crowns).toBe(1);
  });

  it('stocks a dungeon: a hoard in the lair, chests on floor squares, none in the entrance room', () => {
    for (const seed of ['goblin-warren', 'seed-7', 'deep-gloom']) {
      const { map } = generateDungeon(seed);
      const loot = stockDungeon(map, createRng(seed), STARTER_ITEMS, 3);
      expect(loot.filter((l) => l.label?.startsWith('Hoard'))).toHaveLength(1);
      const entrance = map.objects.find((o) => o.kind === 'room')!;
      for (const l of loot) {
        expect(map.terrain[l.at.y * map.width + l.at.x]).toBe('floor');
        if (entrance.kind === 'room') {
          const r = entrance.rect;
          expect(l.at.x >= r.x && l.at.x < r.x + r.w && l.at.y >= r.y && l.at.y < r.y + r.h).toBe(false);
        }
        expect(l.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const { map } = generateDungeon('goblin-warren');
    const strip = (xs: { items: { name: string; qty: number }[] }[]) => xs.map((l) => l.items.map((i) => `${i.qty} ${i.name}`));
    expect(strip(stockDungeon(map, createRng('s'), STARTER_ITEMS, 5))).toEqual(strip(stockDungeon(map, createRng('s'), STARTER_ITEMS, 5)));
  });
});

describe('stats', () => {
  it('computes 2024 ability modifiers', () => {
    expect([1, 8, 9, 10, 11, 12, 15, 20, 30].map(abilityMod)).toEqual([-5, -1, -1, 0, 0, 1, 2, 5, 10]);
  });

  it('damage burns temp HP first; healing caps at max', () => {
    const s = { ...defaultStats(), hp: 10, maxHp: 20, tempHp: 5 };
    expect(applyHp(s, 8)).toMatchObject({ hp: 7, tempHp: undefined });
    expect(applyHp(s, 3)).toMatchObject({ hp: 10, tempHp: 2 });
    expect(applyHp(s, 100).hp).toBe(0);
    expect(applyHp(s, -50).hp).toBe(20);
  });

  it('uses DEX for initiative unless a bonus is set', () => {
    const s = { ...defaultStats(), abilities: { ...defaultStats().abilities, dex: 16 } };
    expect(initiativeBonusOf(token({ stats: s }))).toBe(3);
    expect(initiativeBonusOf(token({ stats: s, initiativeBonus: -1 }))).toBe(-1);
  });
});
