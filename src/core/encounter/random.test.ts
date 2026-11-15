import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../generator/generate';
import { createRng } from '../rng';
import { token } from '../rules/test-helpers';
import { computeVisible, updateFog, FOG_HIDDEN } from '../visibility/fog';
import { footprintSquares } from '../rules/dnd2024';
import { placeGroup, startPoint } from './placement';
import { rollEncounter, unseenRooms } from './random';

describe('random encounters', () => {
  it('places monsters only where the party has never looked', () => {
    let id = 0;
    for (const seed of ['goblin-warren', 'seed-7', 'deep-gloom', 'a', 'b', 'c']) {
      const { map } = generateDungeon(seed);
      const party = placeGroup(map, [1, 2, 3, 4].map(() => token({ mapId: map.id, side: 'party' })), startPoint(map));
      const fog = updateFog(null, computeVisible(map, party.map((t) => ({ ...t.position, size: 1 })), 12));
      const res = rollEncounter(map, party, fog, createRng(seed), () => `m${id++}`);
      expect(res, seed).not.toBeNull();
      for (const m of res!.tokens) {
        expect(m.side).toBe('enemy');
        const s = footprintSquares(m.size);
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++) expect(fog[(m.position.y + dy) * map.width + m.position.x + dx], seed).toBe(FOG_HIDDEN);
      }
    }
  });

  it('returns null once every room has been seen', () => {
    const { map } = generateDungeon('goblin-warren');
    const fog = new Uint8Array(map.width * map.height).fill(1);
    expect(unseenRooms(map, [], fog, 0)).toHaveLength(0);
    expect(rollEncounter(map, [], fog, createRng('x'), () => 'id')).toBeNull();
  });
});
