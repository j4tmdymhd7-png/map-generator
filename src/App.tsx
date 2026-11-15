import { useEffect, useMemo, useRef, useState } from 'react';
import { generateDungeon } from './core/generator/generate';
import { idx } from './core/model/grid';
import type { DungeonMap } from './core/model/types';
import { randomSeed } from './core/rng';

const APP_NAME = 'Dungeon Map Generator';
const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;
const CELL = 16;

/**
 * Temporary generator preview (milestone 1). The real canvas renderer,
 * editor and encounter UI arrive in milestones 2-3.
 */
function drawMap(ctx: CanvasRenderingContext2D, map: DungeonMap) {
  ctx.fillStyle = '#1b1b1f';
  ctx.fillRect(0, 0, map.width * CELL, map.height * CELL);
  const doors = new Map<number, string>();
  for (const o of map.objects) if (o.kind === 'door') doors.set(idx(map, o.at.x, o.at.y), o.state);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.terrain[idx(map, x, y)];
      const px = x * CELL,
        py = y * CELL;
      if (t === 'void') continue;
      if (t === 'wall') {
        ctx.fillStyle = '#4a4a52';
        ctx.fillRect(px, py, CELL, CELL);
        continue;
      }
      // Walkable squares share one light tone; meaning comes from glyphs, not hue.
      ctx.fillStyle = '#e8e2d4';
      ctx.fillRect(px, py, CELL, CELL);
      ctx.strokeStyle = '#c9c1ae';
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      ctx.fillStyle = '#1b1b1f';
      ctx.font = `bold ${CELL - 4}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (t === 'door') {
        const state = doors.get(idx(map, x, y)) ?? 'closed';
        ctx.fillText(state === 'open' ? '◻' : state === 'locked' ? '🔒' : '▣', px + CELL / 2, py + CELL / 2 + 1);
      } else if (t === 'stairs') {
        ctx.fillText('≡', px + CELL / 2, py + CELL / 2 + 1);
      }
    }
  }
}

export default function App() {
  const [seed, setSeed] = useState('goblin-warren');
  const result = useMemo(() => generateDungeon(seed), [seed]);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawMap(ctx, result.map);
  }, [result]);

  const rooms = result.map.objects.filter((o) => o.kind === 'room').length;
  const doors = result.map.objects.filter((o) => o.kind === 'door').length;

  return (
    <div className="app">
      <header className="topbar">
        <strong>{APP_NAME}</strong> <span className="version">v{APP_VERSION}</span>
        <span className="date">{BUILD_DATE}</span>
      </header>
      <main>
        <form className="controls" onSubmit={(e) => e.preventDefault()}>
          <label>
            Seed{' '}
            <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Generator seed" />
          </label>
          <button type="button" onClick={() => setSeed(randomSeed())}>
            New random seed
          </button>
          <span aria-live="polite">
            {rooms} rooms · {doors} doors ·{' '}
            {result.issues.length === 0 ? 'valid ✓' : result.issues.map((i) => i.message).join('; ')}
          </span>
        </form>
        <canvas
          ref={canvas}
          width={result.map.width * CELL}
          height={result.map.height * CELL}
          role="img"
          aria-label={`Generated dungeon for seed ${seed}: ${rooms} rooms and ${doors} doors`}
        />
        <p className="legend">▣ closed door · ◻ open door · ≡ stairs</p>
      </main>
    </div>
  );
}
