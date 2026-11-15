import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rollEncounter } from './core/encounter/random';
import { wanderAll } from './core/encounter/wander';
import { generateDungeon, type Theme } from './core/generator/generate';
import { idx } from './core/model/grid';
import type { DoorState, DungeonMap, GridPolicy, Point, Token } from './core/model/types';
import { footprintSquares } from './core/rules/dnd2024';
import { createRng, randomSeed } from './core/rng';
import { computeVisible, FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE, updateFog } from './core/visibility/fog';
import { TokenPanel } from './encounter/TokenPanel';
import { TurnPanel } from './encounter/TurnPanel';
import { newTokenId, useEncounter } from './encounter/useEncounter';
import { drawFog } from './renderer/fogLayer';
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

function doorAt(map: DungeonMap, p: Point) {
  return map.objects.find((o) => o.kind === 'door' && o.at.x === p.x && o.at.y === p.y) ?? null;
}

function withDoorState(map: DungeonMap, p: Point, state: DoorState): DungeonMap {
  return {
    ...map,
    objects: map.objects.map((o) => (o.kind === 'door' && o.at.x === p.x && o.at.y === p.y ? { ...o, state } : o)),
  };
}

/** Squares covered by a token standing at `p`. */
function footprint(t: Token, p: Point): Point[] {
  const s = footprintSquares(t.size);
  const out: Point[] = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
}

export default function App() {
  const [seed, setSeed] = useState('goblin-warren');
  const [theme, setTheme] = useState<Theme>('dungeon');
  const [showGrid, setShowGrid] = useState(true);
  const [roomNumbers, setRoomNumbers] = useState(true);
  const [hover, setHover] = useState<Point | null>(null);
  const [message, setMessage] = useState<{ text: string; dmOnly?: boolean } | null>(null);

  // Play settings
  const [fogOn, setFogOn] = useState(true);
  const [playerView, setPlayerView] = useState(false);
  const [sightFt, setSightFt] = useState(60);
  const [autoDoors, setAutoDoors] = useState(true);
  const [encounterChance, setEncounterChance] = useState(0);
  const [wandering, setWandering] = useState(true);

  // The generated map, plus live edits (door states) layered on top.
  const generated = useMemo(() => generateDungeon(seed, { theme }), [seed, theme]);
  const [mapState, setMapState] = useState({ source: generated, map: generated.map });
  if (mapState.source !== generated) setMapState({ source: generated, map: generated.map });
  const map = mapState.source === generated ? mapState.map : generated.map;
  const setDoor = (p: Point, state: DoorState) => setMapState((ms) => ({ ...ms, map: withDoorState(ms.map, p, state) }));

  const policy: GridPolicy = useMemo(() => ({ diagonal: 'uniform', closedDoors: autoDoors ? 'passable' : 'block' }), [autoDoors]);
  const controller = useRef<MapViewController | null>(null);
  const requestDraw = useCallback(() => controller.current?.requestDraw(), []);

  // Where a moving token currently is (so fog opens up as it walks).
  const [stepPos, setStepPos] = useState<{ id: string; pos: Point } | null>(null);

  const enc = useEncounter(map, requestDraw, {
    policy,
    onStep: (t, sq) => {
      setStepPos({ id: t.id, pos: sq });
      if (!autoDoors) return;
      for (const c of footprint(t, sq)) {
        const d = doorAt(map, c);
        if (d && d.kind === 'door' && d.state === 'closed') setDoor(c, 'open');
      }
    },
    onMoveEnd: () => setStepPos(null),
  });

  // ---- Fog of war -------------------------------------------------------
  const viewers = useMemo(
    () =>
      enc.tokens
        .filter((t) => t.side === 'party' && t.mapId === map.id)
        .map((t) => ({ ...(stepPos?.id === t.id ? stepPos.pos : t.position), size: footprintSquares(t.size) })),
    [enc.tokens, stepPos, map.id],
  );
  const visible = useMemo(() => computeVisible(map, viewers, sightFt / map.cellSizeFeet), [map, viewers, sightFt]);
  const [fogMem, setFogMem] = useState(() => ({ mapId: map.id, visible, fog: updateFog(null, visible) }));
  if (fogMem.mapId !== map.id || fogMem.visible !== visible) {
    setFogMem({ mapId: map.id, visible, fog: updateFog(fogMem.mapId === map.id ? fogMem.fog : null, visible) });
  }
  const fog = fogMem.mapId === map.id && fogMem.visible === visible ? fogMem.fog : updateFog(null, visible);
  const fogAt = (p: Point) => (fogOn ? fog[idx(map, p.x, p.y)] : FOG_VISIBLE);
  /** What players are allowed to see of a token: party always; others only while in sight. */
  const playersSee = (t: Token) => t.side === 'party' || !fogOn || footprint(t, t.position).some((c) => fogAt(c) === FOG_VISIBLE);
  const hiddenFromPlayers = (p: Point | null) => !!p && playerView && fogAt(p) === FOG_HIDDEN;

  const revealAll = () => setFogMem((f) => ({ ...f, fog: f.fog.map((v) => (v === FOG_HIDDEN ? FOG_EXPLORED : v)) }));
  const reshroud = () => setFogMem((f) => ({ ...f, fog: updateFog(null, f.visible) }));

  // ---- Random encounters --------------------------------------------------
  const rollNow = (prefix = '') => {
    const res = rollEncounter(map, enc.tokens, fog, createRng(randomSeed()), newTokenId);
    if (!res) {
      setMessage({ text: `${prefix}No unseen room far enough from the party for an encounter.`, dmOnly: true });
      return;
    }
    enc.addTokens(res.tokens);
    const n = res.tokens.length;
    setMessage({
      text: `${prefix}Random encounter: ${n > 1 ? `${n} × ${res.entry.name}` : res.entry.name} placed in ${res.room.label} (hidden from players).`,
      dmOnly: true,
    });
  };

  /** Between rounds: unseen monsters wander, then maybe a random encounter. */
  const afterRound = (label: string) => {
    let note = label;
    if (wandering) {
      const res = wanderAll(map, enc.tokens, visible, createRng(randomSeed()));
      if (res.moved.length) {
        enc.setPositions(res.moved);
        note += ` ${res.moved.length} unseen creature${res.moved.length > 1 ? 's' : ''} moved in the dark (${res.moved.map((t) => t.label).join(', ')}).`;
      }
    }
    if (encounterChance > 0 && Math.random() < encounterChance) {
      rollNow(note + ' ');
      return;
    }
    setMessage({ text: note, dmOnly: note !== label });
  };

  const nextRound = () => {
    if (enc.combat) return;
    enc.nextRound();
    afterRound(`Round ${enc.round + 1}: everyone's movement is reset.`);
  };

  const startCombat = () => {
    const participants = enc.tokens.filter((t) => t.mapId === map.id && (t.side === 'party' || !fogOn || footprint(t, t.position).some((c) => visible[idx(map, c.x, c.y)])));
    enc.startCombat(participants);
    setMessage({ text: `Combat! Initiative rolled for ${participants.length} creatures.` });
  };

  const endTurn = () => {
    if (!enc.combat) return;
    const wrapped = enc.endTurn();
    if (wrapped) afterRound(`Round ${enc.round + 1} begins.`);
    else setMessage(null);
  };

  // ---- Movement preview ---------------------------------------------------
  const hoverPath = useMemo(() => (enc.busy || hiddenFromPlayers(hover) ? null : enc.pathFor(hover)), [enc, hover, playerView, fog, fogOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const reachable = useMemo(
    () => (playerView && fogOn ? enc.preview.reachable.filter((p) => fog[idx(map, p.x, p.y)] !== FOG_HIDDEN) : enc.preview.reachable),
    [enc.preview.reachable, playerView, fogOn, fog, map],
  );

  useEffect(() => requestDraw(), [enc.tokens, enc.selected, reachable, hoverPath, fog, fogOn, playerView, requestDraw]);

  const overlay = (ctx: CanvasRenderingContext2D, v: Viewport) => {
    if (fogOn) drawFog(ctx, v, fog, map.width, map.height, playerView ? 'players' : 'dm');
    if (enc.selected && !enc.busy) {
      drawMovePreview(ctx, v, { mover: enc.selected, reachable, path: hoverPath, target: hover });
    }
    const shown = playerView ? enc.tokens.filter(playersSee) : enc.tokens;
    drawTokens(ctx, v, shown, { selectedId: enc.selected?.id ?? null, animating: enc.animating.current, onImageLoad: requestDraw });
  };

  // ---- Input ----------------------------------------------------------------
  const toggleDoor = (cell: Point, lock: boolean) => {
    const d = doorAt(map, cell);
    if (!d || d.kind !== 'door') return false;
    if (tokenAt(enc.tokens, cell)) {
      setMessage({ text: 'Something is standing in the doorway.' });
      return true;
    }
    if (lock) {
      const next = d.state === 'locked' ? 'closed' : 'locked';
      setDoor(cell, next);
      setMessage({ text: next === 'locked' ? 'Door locked.' : 'Door unlocked (still closed).', dmOnly: true });
    } else if (d.state === 'locked') {
      setMessage({ text: 'That door is locked. Shift-click it to unlock (DM).' });
    } else {
      setDoor(cell, d.state === 'open' ? 'closed' : 'open');
      setMessage(null);
    }
    return true;
  };

  const onCellClick = (cell: Point, mods: { shift: boolean }) => {
    if (enc.busy) return;
    const hitRaw = tokenAt(enc.tokens, cell);
    const hit = hitRaw && (!playerView || playersSee(hitRaw)) ? hitRaw : null;
    if (hit && hit.id !== enc.selected?.id) {
      enc.select(hit.id);
      setMessage(null);
      return;
    }
    if (!enc.selected) {
      toggleDoor(cell, mods.shift);
      return;
    }
    if (hit?.id === enc.selected.id) {
      enc.select(null);
      return;
    }
    const refusal = enc.moveTo(cell, mods.shift);
    setMessage(refusal ? { text: refusal } : null);
  };

  const onKey = (e: React.KeyboardEvent): boolean => {
    if (e.key === 'n' || e.key === 'N') {
      if (enc.combat) endTurn();
      else nextRound();
      return true;
    }
    if (e.key === 'Escape' && enc.selected) {
      enc.select(null);
      return true;
    }
    if ((e.key === 'o' || e.key === 'O') && enc.selected) {
      // Open/close a door next to the selected token.
      const t = enc.selected;
      const s = footprintSquares(t.size);
      for (let y = t.position.y - 1; y <= t.position.y + s; y++)
        for (let x = t.position.x - 1; x <= t.position.x + s; x++) if (doorAt(map, { x, y }) && toggleDoor({ x, y }, false)) return true;
      setMessage({ text: `No door next to ${t.label}.` });
      return true;
    }
    const step = KEY_STEPS[e.key];
    if (!step || !enc.selected || enc.busy) return false;
    const p = enc.selected.position;
    const refusal = enc.moveTo({ x: p.x + step.x, y: p.y + step.y }, e.shiftKey);
    setMessage(refusal ? { text: refusal } : null);
    return true;
  };

  // ---- Status text ------------------------------------------------------------
  const rooms = map.objects.filter((o) => o.kind === 'room').length;
  const hoverHidden = hiddenFromPlayers(hover);
  const terrain = hover && !hoverHidden ? map.terrain[hover.y * map.width + hover.x] : null;
  const pathText = hoverPath
    ? hoverPath.legal
      ? `${enc.selected?.label} → ${hoverPath.totalFeet} ft${hoverPath.warnings.length ? ` · ${hoverPath.warnings.join(' ')}` : ''}`
      : hoverPath.reasons.join(' ')
    : null;
  const shownMessage = message && !(message.dmOnly && playerView) ? message.text : null;
  const activeToken = enc.activeId ? enc.tokens.find((t) => t.id === enc.activeId) : null;
  const turnPrefix = activeToken ? `${activeToken.label}'s turn · ` : '';
  const hint = enc.selected
    ? `${turnPrefix}${enc.selected.label} selected · ${enc.remaining(enc.selected)} ft left · click a square to move, O to open/close an adjacent door, Esc to deselect`
    : `${turnPrefix}${rooms} rooms · N for ${enc.combat ? 'next turn' : 'next round'} · click a token to select it · click a door to open or close it (Shift-click to lock)`;

  return (
    <div className="app">
      <header className="topbar">
        <strong>{APP_NAME}</strong> <span className="version">v{APP_VERSION}</span>
        {playerView && <span className="mode-badge">Player view</span>}
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
        <span className="toolbar-sep" aria-hidden />
        <label className="check">
          <input type="checkbox" checked={fogOn} onChange={(e) => setFogOn(e.target.checked)} /> Fog of war
        </label>
        <label className="check">
          <input type="checkbox" checked={playerView} onChange={(e) => setPlayerView(e.target.checked)} disabled={!fogOn} /> Player view
        </label>
      </div>
      <div className="workspace">
        <MapView
          map={map}
          showGrid={showGrid}
          roomNumbers={roomNumbers}
          onHoverCell={(cell) => {
            setHover(cell);
            setMessage(null); // a message only lasts until the pointer moves on
          }}
          onCellClick={onCellClick}
          onCellContext={(cell) => toggleDoor(cell, false)}
          overlay={overlay}
          onKey={onKey}
          controllerRef={controller}
        />
        <TokenPanel enc={enc} hideFromPlayers={playerView ? (t) => !playersSee(t) : undefined}>
          <TurnPanel
            enc={enc}
            onNextRound={nextRound}
            onStartCombat={startCombat}
            onEndTurn={endTurn}
            hidden={playerView ? (t) => !playersSee(t) : undefined}
          />
          <section className="play-controls" aria-label="Play settings">
            <h2>Play</h2>
            <label>
              Party sight
              <select value={sightFt} onChange={(e) => setSightFt(Number(e.target.value))}>
                {[30, 60, 90, 120].map((ft) => (
                  <option key={ft} value={ft}>
                    {ft} ft
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={autoDoors} onChange={(e) => setAutoDoors(e.target.checked)} /> Open doors when walking through
            </label>
            <div className="row">
              <button type="button" onClick={revealAll} disabled={!fogOn}>
                Reveal map
              </button>
              <button type="button" onClick={reshroud} disabled={!fogOn}>
                Re-shroud
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={wandering} onChange={(e) => setWandering(e.target.checked)} /> Unseen monsters wander between rounds
            </label>
            <h3>Random encounters</h3>
            <label>
              Check each new round
              <select value={encounterChance} onChange={(e) => setEncounterChance(Number(e.target.value))}>
                <option value={0}>Off</option>
                <option value={1 / 6}>1 in 6</option>
                <option value={1 / 4}>1 in 4</option>
                <option value={1 / 2}>1 in 2</option>
              </select>
            </label>
            <button type="button" onClick={() => rollNow()} disabled={!fogOn}>
              Roll encounter now
            </button>
            <p className="fine">Monsters are placed in a room the party hasn't seen, and stay hidden in Player view until someone can see them. Placeholder creatures for now.</p>
          </section>
        </TokenPanel>
      </div>
      <footer className="statusbar" aria-live="polite">
        <span>{shownMessage ?? pathText ?? hint}</span>
        <span>{hover ? (hoverHidden ? `Square ${hover.x}, ${hover.y} · unexplored` : `Square ${hover.x}, ${hover.y} · ${terrain}`) : ''}</span>
      </footer>
    </div>
  );
}
