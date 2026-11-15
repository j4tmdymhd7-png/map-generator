/**
 * The DM window and the player screen talk over a BroadcastChannel (same
 * browser, same site). The DM window only ever sends what players may see:
 * tokens already filtered and renamed, places already filtered, and the fog.
 */
import type { DungeonMap, Point, PoiObject, Token } from '../core/model/types';

export const PLAYER_CHANNEL = 'dmg-player-screen';
export const PLAYER_HASH = '#players';

export type PlayerMessage =
  | { type: 'hello' }
  | { type: 'state'; map: DungeonMap; tokens: Token[]; pois: PoiObject[]; fog: Uint8Array | null; activeId: string | null; campaign: string }
  | { type: 'anim'; anim: { id: string; pos: Point } | null }
  | { type: 'bye' };

export function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PLAYER_CHANNEL);
}

/** Open (or bring forward) the player screen window. Returns false if the browser blocked it. */
export function openPlayerScreen(): boolean {
  const url = location.href.split('#')[0] + PLAYER_HASH;
  const w = window.open(url, 'dmg-player-screen', 'popup,width=1280,height=800');
  if (!w) return false;
  w.focus();
  return true;
}

export const isPlayerScreen = () => location.hash === PLAYER_HASH;

/** Players never get DM-only map objects (notes, hidden doors and the like). */
export function playerSafeMap(map: DungeonMap): DungeonMap {
  return { ...map, objects: map.objects.filter((o) => o.visibility !== 'dm' && o.kind !== 'poi') };
}
