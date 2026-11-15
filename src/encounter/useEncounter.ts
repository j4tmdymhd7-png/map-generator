import { useCallback, useMemo, useRef, useState } from 'react';
import { placeGroup, startPoint } from '../core/encounter/placement';
import { rollInitiative, sortInitiative, type InitiativeEntry } from '../core/encounter/initiative';
import { createRng, randomSeed } from '../core/rng';
import type { DungeonMap, GridPolicy, ItemStack, Point, Token } from '../core/model/types';
import { tokenFromTemplate, type CreatureTemplate } from '../core/library/creatures';
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

const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });

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
  /** Put a creature from the library on the map near the selected token (or the entrance). */
  spawn: (template: CreatureTemplate) => Token;
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
  creatures: CreatureTemplate[];
  /** Pocket loot for a creature that carries some. */
  pocketLoot: (t: CreatureTemplate) => ItemStack[];
}

/**
 * Movement, turns and combat on one map. Tokens belong to the campaign (they
 * can be on any map); this hook works with the ones on `map`.
 */
export function useEncounter(map: DungeonMap, allTokens: Token[], setAllTokens: (fn: (ts: Token[]) => Token[]) => void, requestDraw: () => void, opts: EncounterOptions): Encounter {
  const tokens = useMemo(() => allTokens.filter((t) => t.mapId === map.id), [allTokens, map.id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<MoveRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(1);
  const [combat, setCombat] = useState<{ order: InitiativeEntry[]; turn: number } | null>(null);
  // Changing maps ends any fight and clears the turn state.
  const [onMap, setOnMap] = useState(map.id);
  if (onMap !== map.id) {
    setOnMap(map.id);
    setSelectedId(null);
    setSpent({});
    setHistory([]);
    setCombat(null);
  }
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

  const setTokens = setAllTokens;

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
      label: `Hero ${tokens.filter((x) => x.side === 'party').length + 1}`,
      color: '#999999',
      size: 'medium',
      position: { x: 0, y: 0 },
      speeds: { walk: 30 },
      senses: {},
      side: 'party',
      conditions: [],
      visibility: 'public',
      stats: { ac: 12, hp: 10, maxHp: 10, abilities: ab(10, 10, 10, 10, 10, 10) },
    };
    const near = selected?.position ?? startPoint(map);
    const [placed] = placeGroup(map, [t], near, tokens);
    setTokens((ts) => [...ts, placed]);
    setSelectedId(placed.id);
  };

  const addTokens = (ts: Token[]) => setTokens((cur) => [...cur, ...ts]);

  const spawn = (tpl: CreatureTemplate) => {
    const t = tokenFromTemplate(tpl, newTokenId(), map.id);
    if (tpl.carriesLoot) t.inventory = opts.pocketLoot(tpl);
    const near = selected?.position ?? startPoint(map);
    const [placed] = placeGroup(map, [t], near, tokens);
    const withHome = placed.behavior === 'guard' ? { ...placed, home: placed.position } : placed;
    setTokens((ts) => [...ts, withHome]);
    setSelectedId(withHome.id);
    return withHome;
  };

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
    spawn,
    removeToken,
    animating,
    busy,
    assumptions: describeAssumptions(policy, map.cellSizeFeet),
  };
}
