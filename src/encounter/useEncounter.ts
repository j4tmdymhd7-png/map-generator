import { useCallback, useMemo, useRef, useState } from 'react';
import { placeGroup, startPoint } from '../core/encounter/placement';
import { rollInitiative, sortInitiative, type InitiativeEntry } from '../core/encounter/initiative';
import { createRng, randomSeed } from '../core/rng';
import type { DungeonMap, GridPolicy, Point, RoomObject, Token } from '../core/model/types';
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
    { ...base, id: newTokenId(), label: 'Brannoc', color: '#0072b2', size: 'medium', speeds: { walk: 30 }, side: 'party', initiativeBonus: 1 },
    { ...base, id: newTokenId(), label: 'Ilsa Vane', color: '#e69f00', size: 'medium', speeds: { walk: 30 }, side: 'party', initiativeBonus: 2 },
    { ...base, id: newTokenId(), label: 'Tamsin', color: '#009e73', size: 'small', speeds: { walk: 30 }, side: 'party', initiativeBonus: 3 },
    { ...base, id: newTokenId(), label: 'Old Grimm', color: '#cc79a7', size: 'medium', speeds: { walk: 30 }, side: 'party', initiativeBonus: 0 },
  ];
  const foes: Token[] = [
    { ...base, id: newTokenId(), label: 'Ogre', color: '#d55e00', size: 'large', speeds: { walk: 40 }, side: 'enemy', initiativeBonus: -1, behavior: 'guard', leash: 6 },
    { ...base, id: newTokenId(), label: 'Goblin Boss', color: '#56b4e9', size: 'small', speeds: { walk: 30 }, side: 'enemy', initiativeBonus: 2, behavior: 'guard', leash: 6 },
  ];
  const placedParty = placeGroup(map, party, startPoint(map));
  // Foes wait in the room farthest from the entrance.
  const exit = map.objects.find((o) => o.kind === 'stairs' && o.role === 'exit');
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
  const lair = exit && exit.kind === 'stairs' ? exit.at : rooms.length ? rectCenter(rooms[rooms.length - 1].rect) : startPoint(map);
  const placedFoes = placeGroup(map, foes, lair, placedParty).map((t) => ({ ...t, home: t.position }));
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
  round: number;
  /** Initiative order while in combat, else null. */
  combat: { order: InitiativeEntry[]; turn: number } | null;
  activeId: string | null;
  /** Exploration: next round (everyone's movement resets). */
  nextRound: () => void;
  startCombat: (participants: Token[]) => void;
  /** Combat: next creature's turn. Returns true when that wrapped into a new round. */
  endTurn: () => boolean;
  endCombat: () => void;
  joinCombat: (t: Token) => void;
  setInitiative: (tokenId: string, total: number) => void;
  /** Replace positions in bulk (e.g. unseen monsters wandering). */
  setPositions: (moved: Token[]) => void;
  updateToken: (id: string, patch: Partial<Token>) => void;
  addToken: () => void;
  removeToken: (id: string) => void;
  /** Add tokens (e.g. a random encounter). */
  addTokens: (ts: Token[]) => void;
  /** Interpolated position of a token mid-move (for drawing). */
  animating: React.RefObject<{ id: string; pos: Point } | null>;
  busy: boolean;
  assumptions: string[];
}

export interface EncounterOptions {
  policy: GridPolicy;
  /** Called each time a moving token enters a new square (for fog and doors). */
  onStep?: (token: Token, square: Point) => void;
  /** Called when a move finishes. */
  onMoveEnd?: () => void;
}

export function useEncounter(map: DungeonMap, requestDraw: () => void, opts: EncounterOptions): Encounter {
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
    ).map((t) => (t.behavior === 'guard' ? { ...t, home: t.position } : t));
    setState({ mapId: map.id, tokens: [...relocated, ...others] });
  }
  const tokens = state.tokens;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<MoveRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(1);
  const [combat, setCombat] = useState<{ order: InitiativeEntry[]; turn: number } | null>(null);
  const animating = useRef<{ id: string; pos: Point } | null>(null);
  const policy = opts.policy;

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
    let entered = 0;
    const tick = (now: number) => {
      // rAF timestamps are the frame start, which can be slightly before t0.
      const f = Math.max(0, now - t0) / STEP_MS;
      const i = Math.min(Math.floor(f), pts.length - 1);
      while (entered < i) {
        entered++;
        opts.onStep?.(mover, pts[entered]);
      }
      if (i >= pts.length - 1) {
        animating.current = null;
        setTokens((ts) => ts.map((t) => (t.id === mover.id ? { ...t, position: target } : t)));
        setSpent((sp) => ({ ...sp, [mover.id]: (sp[mover.id] ?? 0) + cost }));
        setHistory((h) => [...h, { tokenId: mover.id, from, spentBefore: spent[mover.id] ?? 0 }]);
        setBusy(false);
        opts.onMoveEnd?.();
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

  const nextRound = () => {
    setSpent({});
    setHistory([]);
    setRound((r) => r + 1);
  };

  const beginTurn = (tokenId: string) => {
    setSpent((sp) => ({ ...sp, [tokenId]: 0 }));
    setSelectedId(tokenId);
  };

  const startCombat = (participants: Token[]) => {
    if (participants.length === 0) return;
    const order = rollInitiative(participants, createRng(randomSeed()));
    setCombat({ order, turn: 0 });
    setRound(1);
    setHistory([]);
    beginTurn(order[0].tokenId);
  };

  const endTurn = (): boolean => {
    if (!combat || busy) return false;
    const next = combat.turn + 1;
    const wrapped = next >= combat.order.length;
    const turn = wrapped ? 0 : next;
    setCombat({ ...combat, turn });
    if (wrapped) {
      setRound((r) => r + 1);
      setHistory([]);
    }
    beginTurn(combat.order[turn].tokenId);
    return wrapped;
  };

  const endCombat = () => {
    setCombat(null);
    setSpent({});
    setHistory([]);
    setRound((r) => r + 1);
  };

  const joinCombat = (t: Token) => {
    if (!combat || combat.order.some((e) => e.tokenId === t.id)) return;
    const [entry] = rollInitiative([t], createRng(randomSeed()));
    const activeId = combat.order[combat.turn].tokenId;
    const order = sortInitiative([...combat.order, entry]);
    setCombat({ order, turn: order.findIndex((e) => e.tokenId === activeId) });
  };

  const setInitiative = (tokenId: string, total: number) => {
    if (!combat) return;
    const activeId = combat.order[combat.turn].tokenId;
    const order = sortInitiative(combat.order.map((e) => (e.tokenId === tokenId ? { ...e, total } : e)));
    setCombat({ order, turn: order.findIndex((e) => e.tokenId === activeId) });
  };

  const setPositions = (moved: Token[]) => {
    const byId = new Map(moved.map((t) => [t.id, t.position]));
    setTokens((ts) => ts.map((t) => (byId.has(t.id) ? { ...t, position: byId.get(t.id)! } : t)));
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

  const addTokens = (ts: Token[]) => setTokens((cur) => [...cur, ...ts]);

  const removeToken = (id: string) => {
    setTokens((ts) => ts.filter((t) => t.id !== id));
    if (combat) {
      const activeId = combat.order[combat.turn].tokenId;
      const order = combat.order.filter((e) => e.tokenId !== id);
      if (order.length === 0) setCombat(null);
      else {
        const keep = order.findIndex((e) => e.tokenId === activeId);
        setCombat({ order, turn: keep >= 0 ? keep : Math.min(combat.turn, order.length - 1) });
      }
    }
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
    round,
    combat,
    activeId: combat ? combat.order[combat.turn]?.tokenId ?? null : null,
    nextRound,
    startCombat,
    endTurn,
    endCombat,
    joinCombat,
    setInitiative,
    setPositions,
    updateToken,
    addToken,
    addTokens,
    removeToken,
    animating,
    busy,
    assumptions: describeAssumptions(policy, map.cellSizeFeet),
  };
}
