import { useMemo, useState } from 'react';
import { generateDungeon, type Theme } from './core/generator/generate';
import type { Point } from './core/model/types';
import { randomSeed } from './core/rng';
import { MapView } from './renderer/MapView';

const APP_NAME = 'Dungeon Map Generator';
const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;

export default function App() {
  const [seed, setSeed] = useState('goblin-warren');
  const [theme, setTheme] = useState<Theme>('dungeon');
  const [showGrid, setShowGrid] = useState(true);
  const [roomNumbers, setRoomNumbers] = useState(true);
  const [hover, setHover] = useState<Point | null>(null);
  const result = useMemo(() => generateDungeon(seed, { theme }), [seed, theme]);

  const rooms = result.map.objects.filter((o) => o.kind === 'room').length;
  const doors = result.map.objects.filter((o) => o.kind === 'door').length;
  const terrain = hover ? result.map.terrain[hover.y * result.map.width + hover.x] : null;

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
          <input type="checkbox" checked={roomNumbers} onChange={(e) => setRoomNumbers(e.target.checked)} /> Room
          numbers
        </label>
      </div>
      <MapView map={result.map} showGrid={showGrid} roomNumbers={roomNumbers} onHoverCell={setHover} />
      <footer className="statusbar" aria-live="polite">
        <span>
          {rooms} rooms · {doors} doors ·{' '}
          {result.issues.length === 0 ? 'layout valid ✓' : result.issues.map((i) => i.message).join('; ')}
        </span>
        <span>{hover ? `Square ${hover.x}, ${hover.y} · ${terrain}` : ''}</span>
      </footer>
    </div>
  );
}
