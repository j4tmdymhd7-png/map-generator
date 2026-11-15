import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateDungeon, type Theme } from './core/generator/generate';
import type { Point } from './core/model/types';
import { randomSeed } from './core/rng';
import { TokenPanel } from './encounter/TokenPanel';
import { useEncounter } from './encounter/useEncounter';
import { MapView, type MapViewController } from './renderer/MapView';
import { drawMovePreview, drawTokens, tokenAt } from './renderer/tokens';
import type { Viewport } from './renderer/viewport';

const APP_NAME = 'Dungeon Map Generator';
const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;

/** Arrow keys and numpad-style keys move a selected token one square. */
const KEY_STEPS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  Home: { x: -1, y: -1 },
  PageUp: { x: 1, y: -1 },
  End: { x: -1, y: 1 },
  PageDown: { x: 1, y: 1 },
};

export default function App() {
  const [seed, setSeed] = useState('goblin-warren');
  const [theme, setTheme] = useState<Theme>('dungeon');
  const [showGrid, setShowGrid] = useState(true);
  const [roomNumbers, setRoomNumbers] = useState(true);
  const [hover, setHover] = useState<Point | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const result = useMemo(() => generateDungeon(seed, { theme }), [seed, theme]);
  const map = result.map;

  const controller = useRef<MapViewController | null>(null);
  const requestDraw = useCallback(() => controller.current?.requestDraw(), []);
  const enc = useEncounter(map, requestDraw);

  const hoverPath = useMemo(() => (enc.busy ? null : enc.pathFor(hover)), [enc, hover]);

  // Redraw the token layer whenever anything it shows changes.
  useEffect(() => requestDraw(), [enc.tokens, enc.selected, enc.preview.reachable, hoverPath, requestDraw]);

  const overlay = (ctx: CanvasRenderingContext2D, v: Viewport) => {
    if (enc.selected && !enc.busy) {
      drawMovePreview(ctx, v, { mover: enc.selected, reachable: enc.preview.reachable, path: hoverPath, target: hover });
    }
    drawTokens(ctx, v, enc.tokens, { selectedId: enc.selected?.id ?? null, animating: enc.animating.current, onImageLoad: requestDraw });
  };

  const onCellClick = (cell: Point, mods: { shift: boolean }) => {
    if (enc.busy) return;
    const hit = tokenAt(enc.tokens, cell);
    if (hit && hit.id !== enc.selected?.id) {
      enc.select(hit.id);
      setMessage(null);
      return;
    }
    if (!enc.selected) return;
    if (hit?.id === enc.selected.id) {
      enc.select(null);
      return;
    }
    setMessage(enc.moveTo(cell, mods.shift));
  };

  const onKey = (e: React.KeyboardEvent): boolean => {
    if (e.key === 'Escape' && enc.selected) {
      enc.select(null);
      return true;
    }
    const step = KEY_STEPS[e.key];
    if (!step || !enc.selected || enc.busy) return false;
    const p = enc.selected.position;
    setMessage(enc.moveTo({ x: p.x + step.x, y: p.y + step.y }, e.shiftKey));
    return true;
  };

  const rooms = map.objects.filter((o) => o.kind === 'room').length;
  const terrain = hover ? map.terrain[hover.y * map.width + hover.x] : null;
  const pathText = hoverPath
    ? hoverPath.legal
      ? `${enc.selected?.label} → ${hoverPath.totalFeet} ft${hoverPath.warnings.length ? ` · ${hoverPath.warnings.join(' ')}` : ''}`
      : hoverPath.reasons.join(' ')
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <strong>{APP_NAME}</strong> <span className="version">v{APP_VERSION}</span>
        <span className="date">{BUILD_DATE}</span>
      </header>
      <div className="toolbar" role="toolbar" aria-label="Map options">
        <label>
          Seed <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Generator seed" />
        </label>
        <button type="button" onClick={() => setSeed(randomSeed())}>
          New random seed
        </button>
        <label>
          Theme{' '}
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="dungeon">Dungeon</option>
            <option value="cave">Caves</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid
        </label>
        <label className="check">
          <input type="checkbox" checked={roomNumbers} onChange={(e) => setRoomNumbers(e.target.checked)} /> Room numbers
        </label>
      </div>
      <div className="workspace">
        <MapView
          map={map}
          showGrid={showGrid}
          roomNumbers={roomNumbers}
          onHoverCell={(cell) => {
            setHover(cell);
            setMessage(null); // a refusal message only lasts until the pointer moves on
          }}
          onCellClick={onCellClick}
          overlay={overlay}
          onKey={onKey}
          controllerRef={controller}
        />
        <TokenPanel enc={enc} />
      </div>
      <footer className="statusbar" aria-live="polite">
        <span>
          {message ??
            pathText ??
            (enc.selected
              ? `${enc.selected.label} selected · ${enc.remaining(enc.selected)} ft left · click a square to move, Shift-click to override, Esc to deselect`
              : `${rooms} rooms · ${result.issues.length === 0 ? 'layout valid ✓' : result.issues.map((i) => i.message).join('; ')} · click a token to select it`)}
        </span>
        <span>{hover ? `Square ${hover.x}, ${hover.y} · ${terrain}` : ''}</span>
      </footer>
    </div>
  );
}
