import { createEmptyMap, setDifficult } from '../model/grid';
import type { DungeonMap, Terrain, Token } from '../model/types';

/**
 * Build a map from ASCII art (tests only).
 *   .  floor     #  wall      +  closed door   /  open door   L  locked door
 *   ~  difficult floor        O  pit           X  obstacle    (space) void
 */
export function asciiMap(rows: string[]): DungeonMap {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const map = createEmptyMap({ id: 'm1', title: 'test', width, height });
  const glyph: Record<string, Terrain> = { '.': 'floor', '~': 'floor', '#': 'wall', '+': 'door', '/': 'door', L: 'door', O: 'pit', X: 'obstacle', ' ': 'void' };
  rows.forEach((row, y) => {
    [...row.padEnd(width, ' ')].forEach((ch, x) => {
      map.terrain[y * width + x] = glyph[ch] ?? 'floor';
      if (ch === '~') setDifficult(map, x, y, true);
      if (ch === '+' || ch === '/' || ch === 'L') {
        map.objects.push({
          id: `door-${x}-${y}`,
          kind: 'door',
          at: { x, y },
          state: ch === '+' ? 'closed' : ch === '/' ? 'open' : 'locked',
          visibility: 'public',
        });
      }
    });
  });
  return map;
}

let n = 0;
export function token(over: Partial<Token> = {}): Token {
  n += 1;
  return {
    id: `t${n}`,
    mapId: 'm1',
    label: `Token ${n}`,
    color: '#888',
    size: 'medium',
    position: { x: 0, y: 0 },
    speeds: { walk: 30 },
    senses: {},
    side: 'party',
    conditions: [],
    visibility: 'public',
    ...over,
  };
}
