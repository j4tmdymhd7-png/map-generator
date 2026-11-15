import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DungeonMap, Point } from '../core/model/types';
import { TILE, TileCache, tileCellSize } from './tileCache';
import { fitViewport, screenToCell, zoomAt, type Viewport } from './viewport';

export interface MapViewController {
  /** Ask for a redraw of the dynamic layer (tokens, previews, animation). */
  requestDraw: () => void;
}

interface Props {
  map: DungeonMap;
  showGrid: boolean;
  roomNumbers: boolean;
  onHoverCell?: (cell: Point | null) => void;
  /** Click (not drag) on a square. */
  onCellClick?: (cell: Point, mods: { shift: boolean }) => void;
  /** Right-click on a square. */
  onCellContext?: (cell: Point) => void;
  /** Draws tokens/previews in screen space on top of the map each frame. */
  overlay?: (ctx: CanvasRenderingContext2D, view: Viewport) => void;
  /** Return true if the key was handled (e.g. moving a selected token); otherwise the view pans/zooms. */
  onKey?: (e: React.KeyboardEvent) => boolean;
  controllerRef?: React.RefObject<MapViewController | null>;
}


const ZOOM_STEP = 1.25;
const PAN_STEP = 80;

/**
 * Pannable, zoomable map. The static map is rasterized once into an offscreen
 * bitmap (re-rendered at a sharper resolution after zooming settles) and
 * blitted each frame, so panning stays smooth on large maps.
 */
export function MapView({ map, showGrid, roomNumbers, onHoverCell, onCellClick, onCellContext, overlay, onKey, controllerRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<Viewport>({ zoom: 16, x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const tiles = useRef<TileCache | null>(null);
  const drawSelf = useRef<() => void>(() => {});
  /** Resolution tiles are built at; follows zoom after it settles. */
  const tileCell = useRef(32);
  const hover = useRef<Point | null>(null);
  const frame = useRef(0);
  const rebuildTimer = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);
  const downAt = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const overlayRef = useRef(overlay);
  useLayoutEffect(() => {
    overlayRef.current = overlay;
  });
  const [zoomPct, setZoomPct] = useState(100);

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    const v = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#18171a';
    ctx.fillRect(0, 0, w, h);
    if (!tiles.current) tiles.current = new TileCache(map, { grid: showGrid, roomNumbers });
    // Draw the visible tiles; build a few new ones per frame and fill gaps with
    // any cached resolution so panning never shows holes for long.
    const cell = tileCell.current;
    const tx0 = Math.max(0, Math.floor(-v.x / v.zoom / TILE)),
      ty0 = Math.max(0, Math.floor(-v.y / v.zoom / TILE));
    const tx1 = Math.min(Math.ceil(map.width / TILE) - 1, Math.floor((w - v.x) / v.zoom / TILE)),
      ty1 = Math.min(Math.ceil(map.height / TILE) - 1, Math.floor((h - v.y) / v.zoom / TILE));
    let budget = 6;
    let missing = false;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#f2e8cf';
    ctx.fillRect(v.x, v.y, map.width * v.zoom, map.height * v.zoom);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        let img = tiles.current.get(cell, tx, ty);
        if (!img && budget > 0) {
          img = tiles.current.build(cell, tx, ty);
          budget--;
        }
        if (!img) {
          img = tiles.current.fallback(cell, tx, ty);
          missing = true;
        }
        if (!img) continue;
        const sx = v.x + tx * TILE * v.zoom,
          sy = v.y + ty * TILE * v.zoom;
        const cw = Math.min(TILE, map.width - tx * TILE) * v.zoom,
          ch = Math.min(TILE, map.height - ty * TILE) * v.zoom;
        // Overdraw by a hair to hide seams between tiles.
        ctx.drawImage(img, sx, sy, cw + 0.5, ch + 0.5);
      }
    if (missing) frame.current = requestAnimationFrame(() => drawSelf.current());
    overlayRef.current?.(ctx, v);
    const hc = hover.current;
    if (hc && hc.x >= 0 && hc.y >= 0 && hc.x < map.width && hc.y < map.height) {
      ctx.strokeStyle = 'rgba(42,36,31,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(v.x + hc.x * v.zoom + 1, v.y + hc.y * v.zoom + 1, v.zoom - 2, v.zoom - 2);
      ctx.setLineDash([]);
    }
  }, [map, showGrid, roomNumbers]);

  useLayoutEffect(() => {
    drawSelf.current = draw;
  });

  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    if (controllerRef) controllerRef.current = { requestDraw };
  }, [controllerRef, requestDraw]);

  /** After a zoom, switch tile resolution once the user pauses. */
  const scheduleSharpen = useCallback(() => {
    window.clearTimeout(rebuildTimer.current);
    rebuildTimer.current = window.setTimeout(() => {
      const want = tileCellSize(view.current.zoom, size.current.dpr);
      if (want !== tileCell.current) {
        tileCell.current = want;
        requestDraw();
      }
    }, 150);
  }, [requestDraw]);

  const setView = useCallback(
    (v: Viewport) => {
      const zoomChanged = v.zoom !== view.current.zoom;
      view.current = v;
      if (zoomChanged) {
        setZoomPct(Math.round((v.zoom / 32) * 100));
        scheduleSharpen();
      }
      requestDraw();
    },
    [requestDraw, scheduleSharpen],
  );

  const fit = useCallback(() => {
    const { w, h } = size.current;
    if (w && h) setView(fitViewport(map.width, map.height, w, h));
  }, [map.width, map.height, setView]);

  // Size the canvas to its container (and the device pixel ratio). Fit once,
  // the first time the canvas gets a real size; later resizes keep the view.
  const fitted = useRef(false);
  const fitRef = useRef(fit);
  const drawRef = useRef(requestDraw);
  useLayoutEffect(() => {
    fitRef.current = fit;
    drawRef.current = requestDraw;
  });
  useEffect(() => {
    const wrap = wrapRef.current,
      canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (!fitted.current && rect.width > 0) {
        fitted.current = true;
        fitRef.current();
      }
      drawRef.current();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // New map, an edit (e.g. a door opening) or new drawing options: rebuild the
  // bitmap. Refit only for a different map, not for edits to the same one.
  const lastMapId = useRef<string | null>(null);
  useEffect(() => {
    tiles.current = null;
    if (lastMapId.current !== map.id) {
      lastMapId.current = map.id;
      fit();
    }
    requestDraw();
  }, [map, showGrid, roomNumbers, fit, requestDraw]);

  useEffect(() => () => window.clearTimeout(rebuildTimer.current), []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const updateHover = (p: { x: number; y: number } | null) => {
    const cell = p ? screenToCell(view.current, p.x, p.y) : null;
    const inside = cell && cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height ? cell : null;
    if (inside?.x !== hover.current?.x || inside?.y !== hover.current?.y) {
      hover.current = inside;
      onHoverCell?.(inside);
      requestDraw();
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    downAt.current = pointers.current.size === 1 ? { ...p, moved: false } : null;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      updateHover(p);
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const v = zoomAt(view.current, dist / pinch.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current.dist = dist;
      setView(v);
      return;
    }
    const d = downAt.current;
    if (d && !d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 5) return; // still a click, not a drag yet
    if (d) d.moved = true;
    const v = view.current;
    setView({ ...v, x: v.x + (p.x - prev.x), y: v.y + (p.y - prev.y) });
    updateHover(p);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = downAt.current;
    if (d && !d.moved && pointers.current.size === 1 && e.type === 'pointerup') {
      const cell = screenToCell(view.current, d.x, d.y);
      if (cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height) onCellClick?.(cell, { shift: e.shiftKey });
    }
    downAt.current = null;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // Wheel must be non-passive to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const factor = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 40 : 1));
      setView(zoomAt(view.current, factor, e.clientX - r.left, e.clientY - r.top));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [setView]);

  const zoomCenter = (factor: number) => {
    const { w, h } = size.current;
    setView(zoomAt(view.current, factor, w / 2, h / 2));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (onKey?.(e)) {
      e.preventDefault();
      return;
    }
    const v = view.current;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setView({ ...v, x: v.x + PAN_STEP }),
      ArrowRight: () => setView({ ...v, x: v.x - PAN_STEP }),
      ArrowUp: () => setView({ ...v, y: v.y + PAN_STEP }),
      ArrowDown: () => setView({ ...v, y: v.y - PAN_STEP }),
      '+': () => zoomCenter(ZOOM_STEP),
      '=': () => zoomCenter(ZOOM_STEP),
      '-': () => zoomCenter(1 / ZOOM_STEP),
      '0': fit,
      f: fit,
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div className="mapview" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={`${map.title}. Drag or use arrow keys to pan; scroll or press plus and minus to zoom; press 0 to fit. Click a token to select it, then click a square to move.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => updateHover(null)}
        onContextMenu={(e) => {
          if (!onCellContext) return;
          e.preventDefault();
          const p = local(e);
          const cell = screenToCell(view.current, p.x, p.y);
          if (cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height) onCellContext(cell);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomCenter(ZOOM_STEP)} aria-label="Zoom in" title="Zoom in (+)">
          +
        </button>
        <span className="zoom-readout" aria-live="polite">
          {zoomPct}%
        </span>
        <button type="button" onClick={() => zoomCenter(1 / ZOOM_STEP)} aria-label="Zoom out" title="Zoom out (−)">
          −
        </button>
        <button type="button" onClick={fit} aria-label="Fit map to screen" title="Fit to screen (0)">
          Fit
        </button>
      </div>
    </div>
  );
}
