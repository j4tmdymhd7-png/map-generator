/**
 * Pure geometry derived from a map for drawing. No canvas here, so it's unit-testable.
 */
import { EIGHT_WAY, idx, inBounds, terrainAt } from '../core/model/grid';
import type { DungeonMap, Terrain } from '../core/model/types';

/** Rock is anything you can't stand in that isn't part of the dungeon's open space. */
export function isRock(t: Terrain): boolean {
  return t === 'void' || t === 'wall';
}

export function isOpenAt(map: DungeonMap, x: number, y: number): boolean {
  return !isRock(terrainAt(map, x, y));
}

/** A straight wall line in grid units (cell corners), merged across cells. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Wall lines: every edge between an open cell and rock, merged into the
 * longest straight runs so they can be drawn as single pen strokes.
 */
export function wallSegments(map: DungeonMap): Segment[] {
  const segments: Segment[] = [];

  // Horizontal edges live on grid line y (between row y-1 and row y).
  for (let y = 0; y <= map.height; y++) {
    let runStart = -1;
    for (let x = 0; x <= map.width; x++) {
      const edge = x < map.width && isOpenAt(map, x, y - 1) !== isOpenAt(map, x, y);
      if (edge && runStart < 0) runStart = x;
      if (!edge && runStart >= 0) {
        segments.push({ x1: runStart, y1: y, x2: x, y2: y });
        runStart = -1;
      }
    }
  }
  // Vertical edges live on grid line x.
  for (let x = 0; x <= map.width; x++) {
    let runStart = -1;
    for (let y = 0; y <= map.height; y++) {
      const edge = y < map.height && isOpenAt(map, x - 1, y) !== isOpenAt(map, x, y);
      if (edge && runStart < 0) runStart = y;
      if (!edge && runStart >= 0) {
        segments.push({ x1: x, y1: runStart, x2: x, y2: y });
        runStart = -1;
      }
    }
  }
  return segments;
}

/**
 * Which way a door spans its cell. 'horizontal' means the wall it sits in runs
 * left-right (rock on the left and right), so the door is drawn as a
 * horizontal bar and you pass through it vertically.
 */
export function doorOrientation(map: DungeonMap, x: number, y: number): 'horizontal' | 'vertical' {
  const lr = Number(!isOpenAt(map, x - 1, y)) + Number(!isOpenAt(map, x + 1, y));
  const ud = Number(!isOpenAt(map, x, y - 1)) + Number(!isOpenAt(map, x, y + 1));
  return lr >= ud ? 'horizontal' : 'vertical';
}

/**
 * Chebyshev distance from each rock cell to the nearest open cell, capped at
 * `max` (cells farther than that get max + 1). Open cells get 0. Drives the
 * crosshatch band that hugs the outside of the walls.
 */
export function rockDistance(map: DungeonMap, max = 3): Uint8Array {
  const n = map.width * map.height;
  const dist = new Uint8Array(n).fill(max + 1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isRock(map.terrain[i])) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % map.width,
        y = (i - x) / map.width;
      for (const o of EIGHT_WAY) {
        const nx = x + o.x,
          ny = y + o.y;
        if (!inBounds(map, nx, ny)) continue;
        const ni = idx(map, nx, ny);
        if (dist[ni] > d) {
          dist[ni] = d;
          next.push(ni);
        }
      }
    }
    frontier = next;
  }
  return dist;
}
