/**
 * Fog of war: what the party can see right now, and what they've seen before.
 *
 * Advisory and deliberately simple: line of sight on the grid within a sight
 * radius. It does not model light levels, darkvision vs. dim light,
 * obscurement or invisibility; the DM can always reveal or hide by hand.
 */
import { idx } from '../model/grid';
import type { DungeonMap } from '../model/types';
import { doorStates } from '../rules/dnd2024';
import { TERRAIN } from '../model/terrain';

export const FOG_HIDDEN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

/** Squares that block sight: rock, walls, solid obstacles, trees and any door that isn't open. */
export function opacityGrid(map: DungeonMap): Uint8Array {
  const n = map.width * map.height;
  const out = new Uint8Array(n);
  const doors = doorStates(map);
  for (let i = 0; i < n; i++) {
    const t = map.terrain[i];
    if (t === 'door') out[i] = (doors.get(i) ?? 'closed') !== 'open' ? 1 : 0;
    else if (TERRAIN[t].opaque) out[i] = 1;
  }
  return out;
}

/**
 * Can a viewer standing in square A see square B? Walks the line between the
 * square centers; any opaque square strictly between them blocks it, and so
 * does slipping diagonally between two opaque squares that touch at a corner.
 * B itself may be opaque (you can see a wall).
 */
export function lineOfSight(map: DungeonMap, opaque: Uint8Array, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax,
    dy = by - ay;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
  if (steps === 0) return true;
  let px = ax,
    py = ay;
  for (let s = 1; s <= steps; s++) {
    const fx = ax + 0.5 + (dx * s) / steps,
      fy = ay + 0.5 + (dy * s) / steps;
    const cx = Math.floor(fx),
      cy = Math.floor(fy);
    if (cx === px && cy === py) continue;
    if (cx === bx && cy === by) {
      if (cx !== px && cy !== py && opaque[idx(map, cx, py)] && opaque[idx(map, px, cy)]) return false;
      return true;
    }
    if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return false;
    if (opaque[idx(map, cx, cy)]) return false;
    if (cx !== px && cy !== py && opaque[idx(map, cx, py)] && opaque[idx(map, px, cy)]) return false;
    px = cx;
    py = cy;
  }
  return true;
}

export interface Viewer {
  x: number;
  y: number;
  /** Footprint side length in squares. */
  size: number;
}

/** Squares currently visible (1) to any viewer within `radius` squares. */
export function computeVisible(map: DungeonMap, viewers: Viewer[], radius: number): Uint8Array {
  const opaque = opacityGrid(map);
  const vis = new Uint8Array(map.width * map.height);
  for (const v of viewers) {
    const cx = v.x + (v.size - 1) / 2,
      cy = v.y + (v.size - 1) / 2;
    const x0 = Math.max(0, Math.floor(cx - radius - 1)),
      x1 = Math.min(map.width - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1)),
      y1 = Math.min(map.height - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (vis[i]) continue;
        if (Math.hypot(x - cx, y - cy) > radius + 0.5) continue;
        // A creature sees from any square of its own space.
        let seen = false;
        for (let oy = 0; oy < v.size && !seen; oy++)
          for (let ox = 0; ox < v.size && !seen; ox++) seen = lineOfSight(map, opaque, v.x + ox, v.y + oy, x, y);
        if (seen) vis[i] = 1;
      }
    }
  }
  return vis;
}

/** Fold the current view into fog memory: visible now, explored before, or never seen. */
export function updateFog(prev: Uint8Array | null, visible: Uint8Array): Uint8Array {
  const out = new Uint8Array(visible.length);
  for (let i = 0; i < visible.length; i++) {
    out[i] = visible[i] ? FOG_VISIBLE : prev && prev[i] !== FOG_HIDDEN ? FOG_EXPLORED : FOG_HIDDEN;
  }
  return out;
}
