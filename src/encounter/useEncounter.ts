import { useCallback, useMemo, useRef, useState } from 'react';
import { placeGroup, startPoint } from '../core/encounter/placement';
import { DEFAULT_GRID_POLICY, type DungeonMap, type Point, type RoomObject, type Token } from '../core/model/types';
import { rectCenter } from '../core/model/grid';
import { buildMoveGrid, describeAssumptions, footprintSquares } from '../core/rules/dnd2024';
import { computeReach, pathTo, reachableDestinations, type PathResult } from '../core/rules/pathfinding';

const STEP_MS = 140;

interface MoveRecord {
  tokenId: string;
  from: Point;
  spentBefore: number;
}

let nextTokenNumber = 1;
export function newTokenId(): string {
  return `tok-${Date.now().toString(36)}-${nextTokenNumber++}`;
}

function demoTokens(map: DungeonMap): Token[] {
  const base = { mapId: map.id, position: { x: 0, y: 0 }, senses: {}, conditions: [], visibility: 'public' as const };
  const party: Token[] = [
    { ...base, id: newTokenId(), label: 'Brannoc', color: '#0072b2', size: 'medium', speeds: { walk: 30 }, side: 'party' },
    { ...base, id: newTokenId(), label: 'Ilsa Vane', color: '#e69f00', size: 'medium', speeds: { walk: 30 }, side: 'party' },
    { ...base, id: newTokenId(), label: 'Tamsin', color: '#009e73', size: 'small', speeds: { walk: 30 }, side: 'party' },
    { ...base, id: newTokenId(), label: 'Old Grimm', color: '#cc79a7', size: 'medium', speeds: { walk: 30 }, side: 'party' },
  ];
  const foes: Token[] = [
    { ...base, id: newTokenId(), label: 'Ogre', color: '#d55e00', size: 'large', speeds: { walk: 40 }, side: 'enemy' },
    { ...base, id: newTokenId(), label: 'Goblin Boss', color: '#56b4e9', size: 'small', speeds: { walk: 30 }, side: 'enemy' },
  ];
  const placedParty = placeGroup(map, party, startPoint(map));
  // Foes wait in the room farthest from the entrance.
  const exit = map.objects.find((o) => o.kind === 'stairs' && o.role === 'exit');
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
  const lair = exit && exit.kind === 'stairs' ? exit.at : rooms.length ? rectCenter(rooms[rooms.length - 1].rect) : startPoint(map);
  const placedFoes = placeGroup(map, foes, lair, placedParty);
  return [...placedParty, ...placedFoes];
}

export interface Encounter {
  tokens: Token[];
  selected: Token | null;
  remaining: (t: Token) => number;
  select: (id: string | null) => void;
  preview: { reachable: Point[]; path: PathResult | null };
  /** Path to `target` for the selected token, within its remaining movement. */
  pathFor: (target: Point | null) => PathResult | null;
  /** Animate the selected token to `target`. `override` = DM override: ignore rules. Returns a message if refused. */
  moveTo: (target: Point, override: boolean) => string | null;
  undo: () => void;
  canUndo: boolean;
  newRound: () => void;
  updateToken: (id: string, patch: Partial<Token>) => void;
  addToken: () => void;
  removeToken: (id: string) => void;
  /** Interpolated position of a token mid-move (for drawing). */
  animating: React.RefObject<{ id: string; pos: Point } | null>;
  busy: boolean;
  assumptions: string[];
}

export function useEncounter(map: DungeonMap, requestDraw: () => void): Encounter {
  const [state, setState] = useState(() => ({ mapId: map.id, tokens: demoTokens(map) }));
  // New map: re-place the cast (keeping names and portraits).
  if (state.mapId !== map.id) {
    const relocated = placeGroup(
      map,
      state.tokens.filter((t) => t.side === 'party'),
      startPoint(map),
    );
    const exit = map.objects.find((o) => o.kind === 'stairs' && o.role === 'exit');
    const others = placeGroup(
      map,
      state.tokens.filter((t) => t.side !== 'party'),
      exit && exit.kind === 'stairs' ? exit.at : startPoint(map),
      relocated,
    );
    setState({ mapId: map.id, tokens: [...relocated, ...others] });
  }
  const tokens = state.tokens;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<MoveRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const animating = useRef<{ id: string; pos: Point } | null>(null);
  const policy = DEFAULT_GRID_POLICY;

  const selected = tokens.find((t) => t.id === selectedId) ?? null;
  const remaining = useCallback((t: Token) => Math.max(0, t.speeds.walk - (spent[t.id] ?? 0)), [spent]);

  const reach = useMemo(() => {
    if (!selected) return null;
    const grid = buildMoveGrid(map, selected, tokens, policy);
    return computeReach(grid, selected.position, footprintSquares(selected.size), Infinity);
  }, [map, selected, tokens, policy]);

  const reachable = useMemo(() => {
    if (!reach || !selected) return [];
    return reachableDestinations({ ...reach, budget: remaining(selected) });
  }, [reach, selected, remaining]);

  const pathFor = useCallback(
    (target: Point | null) => {
      if (!reach || !selected || !target) return null;
      if (target.x === selected.position.x && target.y === selected.position.y) return null;
      return pathTo(reach, target, remaining(selected));
    },
    [reach, selected, remaining],
  );

  const setTokens = (fn: (ts: Token[]) => Token[]) => setState((s) => ({ ...s, tokens: fn(s.tokens) }));

  const moveTo = (target: Point, override: boolean): string | null => {
    if (!selected || busy) return null;
    const path = pathFor(target);
    if (!path) return null;
    if (!override && !path.legal) return path.reasons.join(' ');
    const steps: Point[] = path.steps.length && Number.isFinite(path.totalFeet) ? path.steps : [target];
    const cost = Number.isFinite(path.totalFeet) ? path.totalFeet : 0;
    const mover = selected;
    const from = mover.position;

    setBusy(true);
    const t0 = performance.now();
    const pts = [from, ...steps];
    const tick = (now: number) => {
      // rAF timestamps are the frame start, which can be slightly before t0.
      const f = Math.max(0, now - t0) / STEP_MS;
      const i = Math.min(Math.floor(f), pts.length - 1);
      if (i >= pts.length - 1) {
        animating.current = null;
        setTokens((ts) => ts.map((t) => (t.id === mover.id ? { ...t, position: target } : t)));
        setSpent((sp) => ({ ...sp, [mover.id]: (sp[mover.id] ?? 0) + cost }));
        setHistory((h) => [...h, { tokenId: mover.id, from, spentBefore: spent[mover.id] ?? 0 }]);
        setBusy(false);
        requestDraw();
        return;
      }
      // Ease within each step so it reads as a hop from square to square.
      const local = f - i;
      const e = local < 0.5 ? 2 * local * local : 1 - (-2 * local + 2) ** 2 / 2;
      const a = pts[i],
        b = pts[i + 1];
      animating.current = { id: mover.id, pos: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } };
      requestDraw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return null;
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last || busy) return;
    setTokens((ts) => ts.map((t) => (t.id === last.tokenId ? { ...t, position: last.from } : t)));
    setSpent((sp) => ({ ...sp, [last.tokenId]: last.spentBefore }));
    setHistory((h) => h.slice(0, -1));
  };

  const newRound = () => {
    setSpent({});
    setHistory([]);
  };

  const updateToken = (id: string, patch: Partial<Token>) => setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addToken = () => {
    const t: Token = {
      id: newTokenId(),
      mapId: map.id,
      label: `Hero ${tokens.length + 1}`,
      color: '#999999',
      size: 'medium',
      position: { x: 0, y: 0 },
      speeds: { walk: 30 },
      senses: {},
      side: 'party',
      conditions: [],
      visibility: 'public',
    };
    const near = selected?.position ?? startPoint(map);
    const [placed] = placeGroup(map, [t], near, tokens);
    setTokens((ts) => [...ts, placed]);
    setSelectedId(placed.id);
  };

  const removeToken = (id: string) => {
    setTokens((ts) => ts.filter((t) => t.id !== id));
    setHistory((h) => h.filter((m) => m.tokenId !== id));
    if (selectedId === id) setSelectedId(null);
  };

  return {
    tokens,
    selected,
    remaining,
    select: setSelectedId,
    preview: { reachable, path: null },
    pathFor,
    moveTo,
    undo,
    canUndo: history.length > 0 && !busy,
    newRound,
    updateToken,
    addToken,
    removeToken,
    animating,
    busy,
    assumptions: describeAssumptions(policy, map.cellSizeFeet),
  };
}
