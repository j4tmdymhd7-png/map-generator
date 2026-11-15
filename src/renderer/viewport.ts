/** Pure pan/zoom math. `zoom` is screen pixels per grid square. */
export interface Viewport {
  zoom: number;
  /** Screen position (CSS px) of the map's top-left corner. */
  x: number;
  y: number;
}

export const MIN_ZOOM = 6;
export const MAX_ZOOM = 160;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Fit the whole map in the screen with a margin, centered. */
export function fitViewport(mapW: number, mapH: number, screenW: number, screenH: number, margin = 24): Viewport {
  const zoom = clampZoom(Math.min((screenW - margin * 2) / mapW, (screenH - margin * 2) / mapH));
  return { zoom, x: (screenW - mapW * zoom) / 2, y: (screenH - mapH * zoom) / 2 };
}

/** Zoom by `factor`, keeping the map point under (sx, sy) fixed on screen. */
export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
}

export function screenToCell(v: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: Math.floor((sx - v.x) / v.zoom), y: Math.floor((sy - v.y) / v.zoom) };
}

/**
 * Pixels per square to rasterize the static map layer at, for a given zoom.
 * Snaps to powers of two (so small zoom changes reuse the cache) and caps the
 * total bitmap size to keep memory sane on big maps.
 */
export function cacheCellSize(zoom: number, dpr: number, mapW: number, mapH: number, maxPixels = 16_000_000): number {
  const want = 2 ** Math.ceil(Math.log2(Math.max(8, zoom * dpr)));
  const cap = 2 ** Math.floor(Math.log2(Math.sqrt(maxPixels / (mapW * mapH))));
  return Math.max(4, Math.min(want, cap));
}
