import { useCallback, useEffect, useRef, useState } from 'react';
import type { DungeonMap, Point } from '../core/model/types';
import { drawInkMap } from './ink';
import { cacheCellSize, fitViewport, screenToCell, zoomAt, type Viewport } from './viewport';

interface Props {
  map: DungeonMap;
  showGrid: boolean;
  roomNumbers: boolean;
  onHoverCell?: (cell: Point | null) => void;
}

interface Cache {
  canvas: HTMLCanvasElement;
  cell: number;
}

const ZOOM_STEP = 1.25;
const PAN_STEP = 80;

/**
 * Pannable, zoomable map. The static map is rasterized once into an offscreen
 * bitmap (re-rendered at a sharper resolution after zooming settles) and
 * blitted each frame, so panning stays smooth on large maps.
 */
export function MapView({ map, showGrid, roomNumbers, onHoverCell }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<Viewport>({ zoom: 16, x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const cache = useRef<Cache | null>(null);
  const hover = useRef<Point | null>(null);
  const frame = useRef(0);
  const rebuildTimer = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const rebuildCache = useCallback(() => {
    const cell = cacheCellSize(view.current.zoom, size.current.dpr, map.width, map.height);
    const canvas = cache.current?.canvas ?? document.createElement('canvas');
    canvas.width = map.width * cell;
    canvas.height = map.height * cell;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawInkMap(ctx, map, { cell, grid: showGrid, roomNumbers });
    cache.current = { canvas, cell };
  }, [map, showGrid, roomNumbers]);

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
    if (!cache.current) rebuildCache();
    if (cache.current) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 18;
      ctx.drawImage(cache.current.canvas, v.x, v.y, map.width * v.zoom, map.height * v.zoom);
      ctx.restore();
    }
    const hc = hover.current;
    if (hc && hc.x >= 0 && hc.y >= 0 && hc.x < map.width && hc.y < map.height) {
      ctx.strokeStyle = 'rgba(42,36,31,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(v.x + hc.x * v.zoom + 1, v.y + hc.y * v.zoom + 1, v.zoom - 2, v.zoom - 2);
      ctx.setLineDash([]);
    }
  }, [map, rebuildCache]);

  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  /** After a zoom, re-rasterize at the new resolution once the user pauses. */
  const scheduleSharpen = useCallback(() => {
    window.clearTimeout(rebuildTimer.current);
    rebuildTimer.current = window.setTimeout(() => {
      const want = cacheCellSize(view.current.zoom, size.current.dpr, map.width, map.height);
      if (cache.current?.cell !== want) {
        rebuildCache();
        requestDraw();
      }
    }, 150);
  }, [map, rebuildCache, requestDraw]);

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

  // Size the canvas to its container (and the device pixel ratio).
  useEffect(() => {
    const wrap = wrapRef.current,
      canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (first) {
        first = false;
        fit();
      }
      requestDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, requestDraw]);

  // New map or new drawing options: rebuild the bitmap. Refit only for a new map.
  const lastMap = useRef<DungeonMap | null>(null);
  useEffect(() => {
    cache.current = null;
    if (lastMap.current !== map) {
      lastMap.current = map;
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
    pointers.current.set(e.pointerId, local(e));
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
    const v = view.current;
    setView({ ...v, x: v.x + (p.x - prev.x), y: v.y + (p.y - prev.y) });
    updateHover(p);
  };

  const onPointerUp = (e: React.PointerEvent) => {
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
        aria-label={`${map.title}. Drag or use arrow keys to pan; scroll or press plus and minus to zoom; press 0 to fit.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => updateHover(null)}
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
