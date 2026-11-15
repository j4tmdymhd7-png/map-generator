/**
 * One table of what each terrain does, used by movement rules, sight, token
 * placement, validation and loot so they never disagree.
 */
import type { Terrain } from './types';

export interface TerrainInfo {
  /** Can't be entered on foot. */
  blocked: boolean;
  /** Blocks line of sight. */
  opaque: boolean;
  /** Fills its space: diagonal moves can't cut its corner. */
  solid: boolean;
  /** Difficult Terrain (costs double). */
  difficult: boolean;
  /** Good place to put a creature or a chest. */
  standable: boolean;
  /** Counts as open ground for connectivity checks. */
  walkable: boolean;
}

const T = (p: Partial<TerrainInfo>): TerrainInfo => ({
  blocked: false,
  opaque: false,
  solid: false,
  difficult: false,
  standable: false,
  walkable: true,
  ...p,
});

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  void: T({ blocked: true, opaque: true, solid: true, walkable: false }),
  wall: T({ blocked: true, opaque: true, solid: true, walkable: false }),
  obstacle: T({ blocked: true, opaque: true, solid: true, walkable: false }),
  floor: T({ standable: true }),
  stairs: T({ standable: true }),
  door: T({}), // doors are handled by their open/closed state
  pit: T({}),
  hazard: T({}),
  ground: T({ standable: true }),
  road: T({ standable: true }),
  tree: T({ blocked: true, opaque: true, solid: true, walkable: false }),
  brush: T({ difficult: true }),
  water: T({ difficult: true }),
  deepwater: T({ blocked: true, walkable: false }),
  furniture: T({ blocked: true, solid: true, walkable: false }),
};

export const isStandable = (t: Terrain) => TERRAIN[t].standable;
export const isWalkable = (t: Terrain) => TERRAIN[t].walkable;
