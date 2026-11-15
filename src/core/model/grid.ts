import { CellFlag, type DungeonMap, type Point, type Rect, type Terrain } from './types';

export function inBounds(map: Pick<DungeonMap, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function idx(map: Pick<DungeonMap, 'width'>, x: number, y: number): number {
  return y * map.width + x;
}

/** Out-of-bounds reads as 'void'. */
export function terrainAt(map: DungeonMap, x: number, y: number): Terrain {
  return inBounds(map, x, y) ? map.terrain[idx(map, x, y)] : 'void';
}

export function setTerrain(map: DungeonMap, x: number, y: number, t: Terrain): void {
  if (inBounds(map, x, y)) map.terrain[idx(map, x, y)] = t;
}

export function isDifficult(map: DungeonMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && (map.flags[idx(map, x, y)] & CellFlag.Difficult) !== 0;
}

export function setDifficult(map: DungeonMap, x: number, y: number, on: boolean): void {
  if (!inBounds(map, x, y)) return;
  const i = idx(map, x, y);
  map.flags[i] = on ? map.flags[i] | CellFlag.Difficult : map.flags[i] & ~CellFlag.Difficult;
}

export function createEmptyMap(opts: {
  id: string;
  title: string;
  width: number;
  height: number;
  cellSizeFeet?: number;
  fill?: Terrain;
}): DungeonMap {
  const n = opts.width * opts.height;
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width,
    height: opts.height,
    cellSizeFeet: opts.cellSizeFeet ?? 5,
    terrain: new Array<Terrain>(n).fill(opts.fill ?? 'void'),
    flags: new Array<number>(n).fill(0),
    objects: [],
  };
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.w &&
    b.x - margin < a.x + a.w &&
    a.y - margin < b.y + b.h &&
    b.y - margin < a.y + a.h
  );
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

export const ORTHOGONAL: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const EIGHT_WAY: readonly Point[] = [
  ...ORTHOGONAL,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];
