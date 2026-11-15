import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMap, createCampaign, descendants, mapTree, newCampaignId, npcToken, uniqueMapId, type BuildContext } from './campaign/build';
import { CampaignDialog } from './campaign/CampaignDialog';
import { exportCampaign, importCampaignFile, lastCampaignId, loadCampaign, saveCampaign } from './campaign/storage';
import { placeGroup, startPoint } from './core/encounter/placement';
import { rollEncounter } from './core/encounter/random';
import { rollLoot, stackFrom, stockDungeon, tierForLevel } from './core/loot/generate';
import type { ItemDef } from './core/loot/items';
import { LootPanel } from './encounter/LootPanel';
import { LibraryDialog } from './library/LibraryDialog';
import { useLibrary, type Library } from './library/useLibrary';
import { wanderAll } from './core/encounter/wander';
import { generateLinked, generateMap, MAP_SIZES, SIZE_INFO, type MapKind, type MapSize } from './core/generator/maps';
import { idx } from './core/model/grid';
import { decodeFog, encodeFog } from './core/model/schema';
import { SCHEMA_VERSION, type Campaign, type DoorState, type DungeonMap, type GridPolicy, type ItemStack, type LootObject, type NameStyle, type Npc, type Point, type PoiObject, type Token } from './core/model/types';
import { generateNpc } from './core/world/npcs';
import { POI_INFO } from './core/world/poi';
import { drawPois, poiAt } from './renderer/poiLayer';
import { NpcCard } from './world/NpcCard';
import { PeopleDialog } from './world/PeopleDialog';
import { PoiPanel } from './world/PoiPanel';
import { openChannel, openPlayerScreen, playerSafeMap, type PlayerMessage } from './player/channel';
import { NewMapDialog } from './campaign/NewMapDialog';
import { HelpDialog } from './HelpDialog';
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

const DEFAULT_RECIPE = { seed: 'goblin-warren', size: 'medium' as MapSize, kind: 'dungeon' as MapKind };

/** Loads the last campaign (or starts one), then hands it to the workspace. */
export default function App() {
  const lib = useLibrary();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const ctx = (c?: Partial<BuildContext>): BuildContext => ({ items: lib.items, creatures: lib.creatures, partyLevel: 3, used: lib.usedUniques, style: 'generic', newId: newTokenId, ...c });
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  useEffect(() => {
    let live = true;
    const id = lastCampaignId();
    (id ? loadCampaign(id).catch(() => null) : Promise.resolve(null)).then((c) => {
      if (live) setCampaign(c ?? createCampaign('First campaign', DEFAULT_RECIPE, ctxRef.current()));
    });
    return () => {
      live = false;
    };
  }, []);

  if (!campaign)
    return (
      <div className="app loading">
        <header className="topbar">
          <strong>{APP_NAME}</strong> <span className="version">v{APP_VERSION}</span>
          <span className="date">{BUILD_DATE}</span>
        </header>
        <p className="loading-note">Opening your campaign…</p>
      </div>
    );
  return <Workspace key={campaign.id} initial={campaign} lib={lib} onSwitch={setCampaign} newCampaign={(name, recipe, level) => createCampaign(name, recipe, ctx({ partyLevel: level }))} />;
}

function decodeAllFog(c: Campaign): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const m of c.maps) {
    const text = c.fog?.[m.id];
    const fog = text ? decodeFog(text, m.width * m.height) : null;
    if (fog) out[m.id] = fog;
  }
  return out;
}

const isAdjacent = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

function Workspace({
  initial,
  lib,
  onSwitch,
  newCampaign,
}: {
  initial: Campaign;
  lib: Library;
  onSwitch: (c: Campaign) => void;
  newCampaign: (name: string, recipe: { seed: string; size: MapSize; kind: MapKind }, partyLevel: number) => Campaign;
}) {
  // ---- Campaign state (saved) ----------------------------------------------
  const [name, setName] = useState(initial.name);
  const [maps, setMaps] = useState(initial.maps);
  const [activeMapId, setActiveMapId] = useState(initial.activeMapId ?? initial.maps[0].id);
  const [tokens, setTokens] = useState(initial.tokens);
  const [npcs, setNpcs] = useState<Npc[]>(initial.npcs ?? []);
  const [partyLevel, setPartyLevel] = useState(initial.settings.partyLevel ?? 3);
  const [nameStyle, setNameStyle] = useState<NameStyle>(initial.settings.nameStyle ?? 'generic');
  const [autoDoors, setAutoDoors] = useState(initial.settings.grid.closedDoors === 'passable');
  const [fogStore, setFogStore] = useState(() => decodeAllFog(initial));
  const map = maps.find((m) => m.id === activeMapId) ?? maps[0];

  // ---- New-map form ----------------------------------------------------------
  const [seed, setSeed] = useState(map.parent ? DEFAULT_RECIPE.seed : (map.generation?.seed ?? DEFAULT_RECIPE.seed));
  const [size, setSize] = useState<MapSize>(() => (!map.parent && MAP_SIZES.includes(map.recipe?.size as MapSize) ? (map.recipe!.size as MapSize) : DEFAULT_RECIPE.size));
  const [kind, setKind] = useState<MapKind>(() => (SIZE_INFO[size].kinds.some((k) => k.kind === map.recipe?.kind) ? (map.recipe!.kind as MapKind) : SIZE_INFO[size].kinds[0].kind));

  const [showGrid, setShowGrid] = useState(true);
  const [roomNumbers, setRoomNumbers] = useState(true);
  const [hover, setHover] = useState<Point | null>(null);
  const [message, setMessage] = useState<{ text: string; dmOnly?: boolean } | null>(null);

  // Play settings
  const [fogOn, setFogOn] = useState(true);
  const [playerView, setPlayerView] = useState(false);
  const [sightFt, setSightFt] = useState(map.style === 'outdoor' ? 120 : 60);
  const [encounterChance, setEncounterChance] = useState(0);
  const [wandering, setWandering] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      return !localStorage.getItem('dmg.seenHelp.v1');
    } catch {
      return false;
    }
  });
  const [lootId, setLootId] = useState<string | null>(null);
  const [poiId, setPoiId] = useState<string | null>(null);
  const [npcId, setNpcId] = useState<string | null>(null);
  const tier = tierForLevel(partyLevel);
  const ctx: BuildContext = { items: lib.items, creatures: lib.creatures, partyLevel, used: lib.usedUniques, style: nameStyle, newId: newTokenId };

  const editMap = (fn: (m: DungeonMap) => DungeonMap, id = map.id) => setMaps((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  const setDoor = (p: Point, state: DoorState) => editMap((m) => withDoorState(m, p, state));
  const lootObjects = map.objects.filter((o): o is LootObject => o.kind === 'loot');
  const lootAt = (p: Point) => lootObjects.find((l) => l.at.x === p.x && l.at.y === p.y) ?? null;
  const setLootItems = (id: string, items: ItemStack[]) =>
    editMap((m) => ({ ...m, objects: m.objects.map((o) => (o.kind === 'loot' && o.id === id ? { ...o, items } : o)) }));
  const pocketLoot = () => rollLoot(createRng(randomSeed()), tier, 'pocket', lib.items, lib.usedUniques);
  const pois = map.objects.filter((o): o is PoiObject => o.kind === 'poi');
  const editPoi = (id: string, patch: Partial<PoiObject>) => editMap((m) => ({ ...m, objects: m.objects.map((o) => (o.kind === 'poi' && o.id === id ? { ...o, ...patch } : o)) }));
  const npcById = useMemo(() => new Map(npcs.map((n) => [n.id, n])), [npcs]);
  const editNpc = (id: string, patch: Partial<Npc>) => {
    setNpcs((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    if (patch.name !== undefined || patch.attitude !== undefined)
      setTokens((ts) =>
        ts.map((t) =>
          t.npcId === id
            ? { ...t, ...(patch.name !== undefined ? { label: patch.name } : {}), ...(patch.attitude !== undefined ? { side: patch.attitude === 'hostile' ? ('enemy' as const) : ('neutral' as const) } : {}) }
            : t,
        ),
      );
  };

  const policy: GridPolicy = useMemo(() => ({ diagonal: 'uniform', closedDoors: autoDoors ? 'passable' : 'block' }), [autoDoors]);
  const controller = useRef<MapViewController | null>(null);
  const requestDraw = useCallback(() => controller.current?.requestDraw(), []);

  // Where a moving token currently is (so fog opens up as it walks).
  const [stepPos, setStepPos] = useState<{ id: string; pos: Point } | null>(null);

  const enc = useEncounter(map, tokens, setTokens, requestDraw, {
    policy,
    onStep: (t, sq) => {
      setStepPos({ id: t.id, pos: sq });
      if (t.side === 'party') {
        const door = pois.find((p) => POI_INFO[p.poiType].inside && p.at.x === sq.x && p.at.y === sq.y && (p.visibility === 'public' || !playerView));
        if (door) setMessage({ text: `${t.label} is at the way into ${door.name}. Press E to go in.` });
        else if (map.parent && isAdjacent(sq, startPoint(map))) setMessage({ text: `${t.label} is at the way out. Press E to leave.` });
        const found = map.objects.find((o) => o.kind === 'loot' && o.items.length > 0 && Math.abs(o.at.x - sq.x) <= 1 && Math.abs(o.at.y - sq.y) <= 1);
        if (found && found.kind === 'loot') setMessage({ text: `${t.label} found ${found.container === 'chest' ? 'a chest' : 'some loot'}. Click it to see what's inside.` });
      }
      if (!autoDoors) return;
      for (const c of footprint(t, sq)) {
        const d = doorAt(map, c);
        if (d && d.kind === 'door' && d.state === 'closed') setDoor(c, 'open');
      }
    },
    onMoveEnd: () => setStepPos(null),
    creatures: lib.creatures,
    pocketLoot,
  });

  // ---- Loot -----------------------------------------------------------------
  const party = enc.tokens.filter((t) => t.side === 'party');
  /** Add a stack to a token's pack, merging with an identical library item. */
  const addToInventory = (to: Token, stack: ItemStack) => {
    const inv = to.inventory ?? [];
    const same = stack.defId ? inv.find((s) => s.defId === stack.defId && s.name === stack.name) : inv.find((s) => s.category === 'coins' && s.name === stack.name);
    enc.updateToken(to.id, { inventory: same ? inv.map((s) => (s === same ? { ...s, qty: s.qty + stack.qty } : s)) : [...inv, stack] });
    if (stack.defId && lib.items.find((d) => d.id === stack.defId)?.unique) lib.markUsed([stack.defId]);
  };
  const giveFromLoot = (loot: LootObject, stack: ItemStack, to: Token) => {
    setLootItems(loot.id, loot.items.filter((s) => s.id !== stack.id));
    addToInventory(to, stack);
    setMessage({ text: `${to.label} takes ${stack.qty > 1 ? `${stack.qty} × ` : ''}${stack.name}.` });
  };
  const giveFromToken = (from: Token, stack: ItemStack, to: Token) => {
    enc.updateToken(from.id, { inventory: (from.inventory ?? []).filter((s) => s.id !== stack.id) });
    addToInventory(to, stack);
    setMessage({ text: `${from.label} gives ${stack.name} to ${to.label}.` });
  };
  const defeat = (t: Token) => {
    const inv = t.inventory ?? [];
    if (inv.length) {
      const pile: LootObject = {
        id: `loot-drop-${t.id}`,
        kind: 'loot',
        container: 'pile',
        at: t.position,
        items: inv,
        label: `${t.label}'s belongings`,
        visibility: 'public',
      };
      editMap((m) => ({ ...m, objects: [...m.objects, pile] }));
    }
    enc.removeToken(t.id);
    setMessage({ text: inv.length ? `${t.label} is defeated and drops ${inv.length} item${inv.length > 1 ? 's' : ''}.` : `${t.label} is defeated.` });
  };
  const restock = () => {
    const used = new Set([...lib.usedUniques, ...party.flatMap((t) => (t.inventory ?? []).map((s) => s.defId ?? ''))]);
    editMap((m) => ({ ...m, objects: [...m.objects.filter((o) => o.kind !== 'loot'), ...stockDungeon(m, createRng(randomSeed()), lib.items, partyLevel, used)] }));
    setLootId(null);
    setMessage({ text: 'Loot rerolled for the whole dungeon.', dmOnly: true });
  };
  const selectedLoot = lootId ? lootObjects.find((l) => l.id === lootId) ?? null : null;

  // ---- Fog of war -------------------------------------------------------
  const viewers = useMemo(
    () =>
      enc.tokens
        .filter((t) => t.side === 'party' && t.mapId === map.id)
        .map((t) => ({ ...(stepPos?.id === t.id ? stepPos.pos : t.position), size: footprintSquares(t.size) })),
    [enc.tokens, stepPos, map.id],
  );
  const visible = useMemo(() => computeVisible(map, viewers, sightFt / map.cellSizeFeet), [map, viewers, sightFt]);
  // Fog memory for the map on screen; other maps' fog waits in fogStore.
  const [fogMem, setFogMem] = useState(() => ({ mapId: map.id, visible, fog: updateFog(fogStore[map.id] ?? null, visible) }));
  if (fogMem.mapId !== map.id || fogMem.visible !== visible) {
    if (fogMem.mapId !== map.id) setFogStore((s) => ({ ...s, [fogMem.mapId]: fogMem.fog }));
    setFogMem({ mapId: map.id, visible, fog: updateFog(fogMem.mapId === map.id ? fogMem.fog : (fogStore[map.id] ?? null), visible) });
  }
  const fog = fogMem.mapId === map.id && fogMem.visible === visible ? fogMem.fog : updateFog(fogStore[map.id] ?? null, visible);
  const fogAt = (p: Point) => (fogOn ? fog[idx(map, p.x, p.y)] : FOG_VISIBLE);
  /** What players are allowed to see of a token: party always; others only while in sight. */
  const playersSee = (t: Token) => t.side === 'party' || !fogOn || footprint(t, t.position).some((c) => fogAt(c) === FOG_VISIBLE);
  const hiddenFromPlayers = (p: Point | null) => !!p && playerView && fogAt(p) === FOG_HIDDEN;

  const revealAll = () => setFogMem((f) => ({ ...f, fog: f.fog.map((v) => (v === FOG_HIDDEN ? FOG_EXPLORED : v)) }));
  const reshroud = () => setFogMem((f) => ({ ...f, fog: updateFog(null, f.visible) }));


  // ---- Places, people and travel -------------------------------------------
  const disguise = (t: Token): Token => {
    const n = t.npcId ? npcById.get(t.npcId) : undefined;
    return n && !n.known ? { ...t, label: n.descriptor } : t;
  };
  const poiSeen = (p: PoiObject) => !fogOn || fogAt(p.at) !== FOG_HIDDEN || (!!p.rect && fogAt({ x: p.rect.x + (p.rect.w >> 1), y: p.rect.y + (p.rect.h >> 1) }) !== FOG_HIDDEN);
  const visiblePoi = (p: PoiObject | null) => (p && (!playerView || (p.visibility === 'public' && poiSeen(p))) ? p : null);
  const selectedPoi = poiId ? (pois.find((p) => p.id === poiId) ?? null) : null;
  const parentMap = map.parent ? (maps.find((m) => m.id === map.parent!.mapId) ?? null) : null;

  /** Move the party on map `fromId` to `target`, next to `near`. */
  const moveParty = (fromId: string, target: DungeonMap, near: Point) =>
    setTokens((ts) => {
      const party = ts.filter((t) => t.side === 'party' && t.mapId === fromId);
      const rest = ts.filter((t) => !(t.side === 'party' && t.mapId === fromId));
      return [...rest, ...placeGroup(target, party, near, rest.filter((t) => t.mapId === target.id))];
    });

  const goTo = (target: DungeonMap) => {
    setActiveMapId(target.id);
    setPoiId(null);
    setLootId(null);
    setNpcId(null);
    if (target.style === 'outdoor') setSightFt((s) => Math.max(s, 120));
  };

  const enter = (poi: PoiObject) => {
    let target = poi.link ? maps.find((m) => m.id === poi.link!.mapId) : undefined;
    if (!target) {
      const res = generateLinked(map, poi);
      if (!res) {
        setMessage({ text: `${poi.name} has no inside to go into.` });
        return;
      }
      res.map.id = uniqueMapId(maps, res.map.id);
      res.map.parent = { mapId: map.id, poiId: poi.id };
      const built = buildMap(res.map, ctx, npcs, poi);
      target = built.map;
      const linkTo = target.id;
      setMaps((ms) => [...ms.map((m) => (m.id === map.id ? { ...m, objects: m.objects.map((o) => (o.id === poi.id && o.kind === 'poi' ? { ...o, link: { mapId: linkTo } } : o)) } : m)), built.map]);
      setNpcs((ns) => [...ns, ...built.npcs]);
      setTokens((ts) => [...ts, ...built.tokens]);
    }
    moveParty(map.id, target, startPoint(target));
    goTo(target);
    setMessage({ text: `The party goes into ${poi.name}.` });
  };

  const leave = () => {
    if (!parentMap || !map.parent) return;
    const poi = parentMap.objects.find((o): o is PoiObject => o.kind === 'poi' && o.id === map.parent!.poiId);
    moveParty(map.id, parentMap, poi?.at ?? startPoint(parentMap));
    goTo(parentMap);
    setMessage({ text: `The party leaves ${map.title}.` });
  };

  /** A new top-level map from the toolbar recipe. `replace` swaps it in for the current map. */
  const newMap = (replace: boolean) => {
    const removed = replace ? [map.id, ...descendants(maps, map.id)] : [];
    if (replace && removed.length > 1 && !window.confirm(`Replacing this map also removes the ${removed.length - 1} place${removed.length > 2 ? 's' : ''} inside it, and the people there. Go ahead?`)) return;
    const res = generateMap(seed, size, kind, nameStyle);
    const keep = maps.filter((m) => !removed.includes(m.id));
    res.map.id = uniqueMapId(keep, res.map.id);
    const built = buildMap(res.map, ctx, npcs);
    setMaps(replace ? maps.flatMap((m) => (m.id === map.id ? [built.map] : removed.includes(m.id) ? [] : [m])) : [...maps, built.map]);
    setNpcs((ns) => [...ns.filter((n) => !n.mapId || !removed.includes(n.mapId)), ...built.npcs]);
    setTokens((ts) => {
      const party = ts.filter((t) => t.side === 'party' && (t.mapId === map.id || removed.includes(t.mapId)));
      const rest = ts.filter((t) => !removed.includes(t.mapId) && !party.includes(t));
      return [...rest, ...built.tokens, ...placeGroup(built.map, party, startPoint(built.map), built.tokens)];
    });
    if (replace) setFogStore((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !removed.includes(id))));
    goTo(built.map);
    setSightFt(size === 'huge' || size === 'gargantuan' ? 120 : 60);
    setMessage({ text: replace ? `Map replaced: ${built.map.title}.` : `New map added: ${built.map.title}. The party is there now.` });
  };

  const placeNpc = (npc: Npc) => {
    const t = npcToken(npc, map.id, newTokenId());
    const work = npc.workPoiId ? pois.find((p) => p.id === npc.workPoiId) : undefined;
    const near = enc.selected?.position ?? work?.at ?? startPoint(map);
    const [placed] = placeGroup(map, [t], near, enc.tokens);
    setTokens((ts) => [...ts, placed]);
    enc.select(placed.id);
    setNpcId(null);
  };
  const sell = (item: ItemDef, to: Token) => {
    addToInventory(to, stackFrom(item));
    setMessage({ text: `${to.label} buys ${item.name}${item.valueGp !== undefined ? ` for ${item.valueGp} gp` : ''}.` });
  };
  const npcCard = (n: Npc, close?: () => void) => {
    const work = n.workPoiId ? maps.flatMap((m) => m.objects).find((o): o is PoiObject => o.kind === 'poi' && o.id === n.workPoiId) : undefined;
    return (
      <NpcCard
        key={n.id}
        npc={n}
        playerView={playerView}
        items={lib.items}
        party={party}
        placeName={work?.name}
        onChange={(patch) => editNpc(n.id, patch)}
        onSell={sell}
        onPlace={enc.tokens.some((t) => t.npcId === n.id) ? undefined : () => placeNpc(n)}
        onClose={close}
      />
    );
  };


  // ---- Player screen (a second window to share on Discord) -------------------
  const playerState = (): PlayerMessage => ({
    type: 'state',
    map: playerSafeMap(map),
    tokens: (fogOn ? enc.tokens.filter(playersSee) : enc.tokens).map(disguise),
    pois: pois.filter((p) => p.visibility === 'public' && poiSeen(p)),
    fog: fogOn ? fog : null,
    activeId: enc.activeId,
    campaign: name,
  });
  const playerStateRef = useRef(playerState);
  useEffect(() => {
    playerStateRef.current = playerState;
  });
  const channel = useRef<BroadcastChannel | null>(null);
  const screenOpen = useRef(false);
  useEffect(() => {
    const ch = openChannel();
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<PlayerMessage>) => {
      if (e.data.type !== 'hello') return;
      screenOpen.current = true;
      ch.postMessage(playerStateRef.current());
    };
    const bye = () => ch.postMessage({ type: 'bye' } satisfies PlayerMessage);
    window.addEventListener('pagehide', bye);
    return () => {
      bye();
      window.removeEventListener('pagehide', bye);
      ch.close();
    };
  }, []);
  useEffect(() => {
    if (screenOpen.current) channel.current?.postMessage(playerStateRef.current());
  }, [map, enc.tokens, fog, fogOn, npcs, enc.activeId]);
  const lastAnim = useRef<string>('');
  const sendAnim = () => {
    if (!screenOpen.current) return;
    const a = enc.animating.current;
    const key = a ? `${a.id}:${a.pos.x.toFixed(2)}:${a.pos.y.toFixed(2)}` : '';
    if (key === lastAnim.current) return;
    lastAnim.current = key;
    channel.current?.postMessage({ type: 'anim', anim: a } satisfies PlayerMessage);
  };
  const showPlayerScreen = () => {
    if (!openPlayerScreen()) setMessage({ text: 'The browser blocked the player screen window. Allow pop-ups for this page and try again.' });
    else setMessage({ text: 'Player screen opened. Share that window in Discord (Screen Share → choose the window).' });
  };

  // ---- Saving ------------------------------------------------------------------
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const snapshot = (): Campaign => {
    const fogs = { ...fogStore, [fogMem.mapId]: fogMem.fog };
    const ids = new Set(maps.map((m) => m.id));
    return {
      schemaVersion: SCHEMA_VERSION,
      id: initial.id,
      name,
      ruleset: initial.ruleset,
      maps,
      tokens,
      settings: { grid: policy, partyLevel, nameStyle },
      activeMapId: map.id,
      fog: Object.fromEntries(Object.entries(fogs).filter(([id]) => ids.has(id)).map(([id, f]) => [id, encodeFog(f)])),
      npcs,
      clock: initial.clock,
      updatedAt: new Date().toISOString(),
    };
  };
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  });
  useEffect(() => {
    const t = setTimeout(() => {
      setSaveState('saving');
      saveCampaign(snapshotRef.current())
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 800);
    return () => clearTimeout(t);
  }, [name, maps, tokens, npcs, fogMem.fog, activeMapId, partyLevel, nameStyle, policy]);
  const saveNow = () => saveCampaign(snapshotRef.current()).catch(() => undefined);

  // ---- Random encounters --------------------------------------------------
  const rollNow = (prefix = '') => {
    const res = rollEncounter(map, enc.tokens, fog, createRng(randomSeed()), newTokenId, lib.creatures, { items: lib.items, tier, used: lib.usedUniques });
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
    if (encounterChance > 0 && createRng(randomSeed()).chance(encounterChance)) {
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

  useEffect(() => requestDraw(), [enc.tokens, enc.selected, reachable, hoverPath, fog, fogOn, playerView, requestDraw, map, poiId, npcs]);

  const overlay = (ctx: CanvasRenderingContext2D, v: Viewport) => {
    drawPois(ctx, v, pois, { playerView, selectedId: poiId, seen: poiSeen });
    if (fogOn) drawFog(ctx, v, fog, map.width, map.height, playerView ? 'players' : 'dm');
    if (enc.selected && !enc.busy) {
      drawMovePreview(ctx, v, { mover: enc.selected, reachable, path: hoverPath, target: hover });
    }
    const shown = playerView ? enc.tokens.filter(playersSee).map(disguise) : enc.tokens;
    drawTokens(ctx, v, shown, {
      selectedId: enc.selected?.id ?? null,
      animating: enc.animating.current,
      onImageLoad: requestDraw,
      showHp: !playerView,
      activeId: enc.activeId,
    });
    sendAnim();
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
      setNpcId(null);
      setMessage(null);
      return;
    }
    if (!enc.selected) {
      const loot = lootAt(cell);
      if (loot && (!playerView || fogAt(cell) !== FOG_HIDDEN)) {
        setLootId(loot.id === lootId ? null : loot.id);
        return;
      }
      if (toggleDoor(cell, mods.shift)) return;
      const place = visiblePoi(poiAt(pois, cell));
      setPoiId(place && place.id !== poiId ? place.id : null);
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
    if (e.key === 'Escape' && (enc.selected || poiId || lootId)) {
      enc.select(null);
      setPoiId(null);
      setLootId(null);
      return true;
    }
    if ((e.key === 'e' || e.key === 'E') && enc.selected) {
      // Go in (or out) through an entrance next to the selected hero.
      const t = enc.selected;
      if (t.side !== 'party') return false;
      const door = pois.find((p) => POI_INFO[p.poiType].inside && isAdjacent(p.at, t.position) && (p.visibility === 'public' || !playerView));
      if (door) enter(door);
      else if (map.parent && isAdjacent(startPoint(map), t.position)) leave();
      else setMessage({ text: `${t.label} isn't next to a way in or out. Entrances are marked with a ◆.` });
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
  const hoverPoi = hover && !hoverHidden ? visiblePoi(poiAt(pois, hover)) : null;
  const pathText = hoverPath
    ? hoverPath.legal
      ? `${enc.selected?.label} → ${hoverPath.totalFeet} ft${hoverPath.warnings.length ? ` · ${hoverPath.warnings.join(' ')}` : ''}`
      : hoverPath.reasons.join(' ')
    : null;
  const shownMessage = message && !(message.dmOnly && playerView) ? message.text : null;
  const activeToken = enc.activeId ? enc.tokens.find((t) => t.id === enc.activeId) : null;
  const turnPrefix = activeToken ? `${activeToken.label}'s turn · ` : '';
  const hint = enc.selected
    ? `${turnPrefix}${enc.selected.label}: ${enc.remaining(enc.selected)} ft left · click a square to move · Esc to deselect`
    : `${turnPrefix}${map.title} · ${pois.length ? `${pois.length} places` : `${rooms} ${map.style === 'outdoor' ? 'areas' : 'rooms'}`} · click a token to select it · N: ${enc.combat ? 'next turn' : 'next round'} · ? for help`;
  const encView = playerView ? { ...enc, tokens: enc.tokens.map(disguise), selected: enc.selected && disguise(enc.selected) } : enc;
  const selectedNpc = enc.selected?.npcId ? npcById.get(enc.selected.npcId) : npcId ? npcById.get(npcId) : undefined;
  const tree = mapTree(maps);

  return (
    <div className="app">
      <header className="topbar">
        <strong>{APP_NAME}</strong> <span className="version">v{APP_VERSION}</span>
        {playerView && <span className="mode-badge">Previewing as players</span>}
        <span className="date">{BUILD_DATE}</span>
      </header>
      <div className="toolbar" role="toolbar" aria-label="Campaign and view">
        <button type="button" onClick={() => setCampaignOpen(true)} title="Campaign: rename, switch, start a new one, or back up to a file">
          <strong>{name || 'Untitled'}</strong> ▾
        </button>
        <label title="Every map in this campaign. Looking at another map doesn't move the party.">
          <span className="sr-only">Map</span>
          <select value={map.id} onChange={(e) => goTo(maps.find((m) => m.id === e.target.value)!)} aria-label="Map on screen">
            {tree.map(({ map: m, depth }) => (
              <option key={m.id} value={m.id}>
                {'\u2003'.repeat(depth)}
                {depth ? '↳ ' : ''}
                {m.title}
                {tokens.some((t) => t.side === 'party' && t.mapId === m.id) ? ' (party here)' : ''}
              </option>
            ))}
          </select>
        </label>
        {parentMap && (
          <button type="button" onClick={leave} title="The party walks back out (or press E at the way out)">
            ← Leave to {parentMap.title}
          </button>
        )}
        <button type="button" onClick={() => setNewMapOpen(true)} title="Generate a tavern, dungeon, cave, town, forest, city or wilderness">
          + New map
        </button>
        <button type="button" onClick={() => setPeopleOpen(true)} title="Every NPC in the campaign and every place on this map">
          People &amp; places
        </button>
        <button type="button" onClick={() => setLibraryOpen(true)} title="Your creatures and items: stats, loot, quest items">
          Library
        </button>
        <span className="toolbar-sep" aria-hidden />
        <details className="view-menu">
          <summary title="Grid, room numbers and fog of war">View</summary>
          <div className="view-menu-body">
            <label className="check">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid
            </label>
            <label className="check">
              <input type="checkbox" checked={roomNumbers} onChange={(e) => setRoomNumbers(e.target.checked)} /> Room numbers
            </label>
            <label className="check" title="Hide what the party hasn't seen">
              <input type="checkbox" checked={fogOn} onChange={(e) => setFogOn(e.target.checked)} /> Fog of war
            </label>
          </div>
        </details>
        <label className="check" title={fogOn ? 'See this window exactly as the players do' : 'Turn on fog of war first'}>
          <input type="checkbox" checked={playerView} onChange={(e) => setPlayerView(e.target.checked)} disabled={!fogOn} /> Preview as players
        </label>
        <button type="button" className="primary" onClick={showPlayerScreen} title="Open a second window showing only what players see, to share in Discord">
          Player screen ↗
        </button>
        <span className={`save-state ${saveState}`} role="status" title="Saved automatically in this browser. Export from the campaign menu to back up.">
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Not saved: export a file to keep your work'}
        </span>
        <button type="button" className="help-button" onClick={() => setHelpOpen(true)} title="How to use this tool" aria-label="How to use">
          ?
        </button>
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
        <TokenPanel
          enc={encView}
          hideFromPlayers={playerView ? (t) => !playersSee(t) : undefined}
          playerView={playerView}
          creatures={lib.creatures}
          items={lib.items}
          onGive={giveFromToken}
          onDefeat={defeat}
        >
          {map.parent && parentMap && (
            <section className="location" aria-label="Where the party is">
              <p>
                Inside <strong>{map.title}</strong>, in {parentMap.title}.
              </p>
              <button type="button" onClick={leave}>
                Leave to {parentMap.title}
              </button>
            </section>
          )}
          {selectedPoi && (
            <PoiPanel
              key={selectedPoi.id}
              poi={selectedPoi}
              people={npcs.filter((n) => n.workPoiId === selectedPoi.id)}
              playerView={playerView}
              onChange={(patch) => editPoi(selectedPoi.id, patch)}
              onEnter={() => enter(selectedPoi)}
              onOpenNpc={(n) => {
                enc.select(null);
                setNpcId(n.id);
              }}
              onClose={() => setPoiId(null)}
            />
          )}
          {selectedNpc && npcCard(selectedNpc, () => (enc.selected?.npcId ? enc.select(null) : setNpcId(null)))}
          {selectedLoot &&
            (playerView ? (
              <p className="fine">Loot details are hidden in Player view.</p>
            ) : (
              <LootPanel
                loot={selectedLoot}
                items={lib.items}
                party={party}
                onChange={(items) => setLootItems(selectedLoot.id, items)}
                onGive={(stack, to) => giveFromLoot(selectedLoot, stack, to)}
                onGiveAll={(to) => {
                  for (const s of selectedLoot.items) addToInventory(to, s);
                  setLootItems(selectedLoot.id, []);
                  setMessage({ text: `${to.label} takes everything from ${selectedLoot.label ?? 'the chest'}.` });
                }}
                onReroll={() =>
                  setLootItems(
                    selectedLoot.id,
                    rollLoot(createRng(randomSeed()), tier, selectedLoot.label?.startsWith('Hoard') ? 'hoard' : selectedLoot.container === 'pile' ? 'pocket' : 'cache', lib.items, lib.usedUniques),
                  )
                }
                onRemove={() => {
                  editMap((m) => ({ ...m, objects: m.objects.filter((o) => o.id !== selectedLoot.id) }));
                  setLootId(null);
                }}
                onClose={() => setLootId(null)}
              />
            ))}
          <TurnPanel
            enc={enc}
            onNextRound={nextRound}
            onStartCombat={startCombat}
            onEndTurn={endTurn}
            hidden={playerView ? (t) => !playersSee(t) : undefined}
          />
          {!playerView && (
            <section className="play-controls" aria-label="DM settings">
              <details className="panel-group">
                <summary>Exploration</summary>
                <label title="How far the party can see. Fog lifts within this range.">
                  Party sight
                  <select value={sightFt} onChange={(e) => setSightFt(Number(e.target.value))}>
                    {[30, 60, 90, 120, 240].map((ft) => (
                      <option key={ft} value={ft}>
                        {ft} ft
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check" title="Closed doors swing open when a token walks through them. Locked doors still block.">
                  <input type="checkbox" checked={autoDoors} onChange={(e) => setAutoDoors(e.target.checked)} /> Open doors when walking through
                </label>
                <label className="check" title="Between rounds, creatures the party can't see may move. Guards stay near home.">
                  <input type="checkbox" checked={wandering} onChange={(e) => setWandering(e.target.checked)} /> Unseen monsters wander
                </label>
                <div className="row">
                  <button type="button" onClick={revealAll} disabled={!fogOn} title="Mark the whole map as explored">
                    Reveal map
                  </button>
                  <button type="button" onClick={reshroud} disabled={!fogOn} title="Forget everything explored">
                    Re-shroud
                  </button>
                </div>
              </details>
              <details className="panel-group">
                <summary>Loot</summary>
                <label title="Sets how much treasure chests and creatures carry (tiers 1–4)">
                  Party level
                  <select value={partyLevel} onChange={(e) => setPartyLevel(Number(e.target.value))}>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((l) => (
                      <option key={l} value={l}>
                        Level {l} (tier {tierForLevel(l)})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={restock} title="Restock every chest on this map. Click a chest (nothing selected) to see inside.">
                  Reroll this map's loot ({lootObjects.length} chests)
                </button>
              </details>
              <details className="panel-group">
                <summary>Random encounters</summary>
                <label title="Chance of an encounter each new round. Monsters appear in a room the party hasn't seen.">
                  Check each round
                  <select value={encounterChance} onChange={(e) => setEncounterChance(Number(e.target.value))}>
                    <option value={0}>Off</option>
                    <option value={1 / 6}>1 in 6</option>
                    <option value={1 / 4}>1 in 4</option>
                    <option value={1 / 2}>1 in 2</option>
                  </select>
                </label>
                <button type="button" onClick={() => rollNow()} disabled={!fogOn} title="Place an encounter now, out of the party's sight">
                  Roll encounter now
                </button>
              </details>
            </section>
          )}
        </TokenPanel>
      </div>
      {newMapOpen && (
        <NewMapDialog
          seed={seed}
          size={size}
          kind={kind}
          onSeed={setSeed}
          onSize={setSize}
          onKind={setKind}
          replaceBlocked={map.parent ? 'This place was made from the map around it. Replace that map instead.' : undefined}
          onAdd={() => newMap(false)}
          onReplace={() => newMap(true)}
          onClose={() => setNewMapOpen(false)}
        />
      )}
      {helpOpen && (
        <HelpDialog
          onClose={() => {
            setHelpOpen(false);
            try {
              localStorage.setItem('dmg.seenHelp.v1', '1');
            } catch {
              // ignore
            }
          }}
        />
      )}
      {libraryOpen && <LibraryDialog lib={lib} onClose={() => setLibraryOpen(false)} />}
      {peopleOpen && (
        <PeopleDialog
          npcs={npcs}
          maps={maps}
          current={map}
          items={lib.items}
          party={party}
          nameStyle={nameStyle}
          onNameStyle={setNameStyle}
          onChangeNpc={editNpc}
          onNewNpc={() => {
            const n = generateNpc(createRng(randomSeed()), 'Commoner', 'Stranger', nameStyle);
            n.mapId = map.id;
            setNpcs((ns) => [...ns, n]);
            return n;
          }}
          onDeleteNpc={(id) => {
            setNpcs((ns) => ns.filter((n) => n.id !== id));
            setTokens((ts) => ts.filter((t) => t.npcId !== id));
          }}
          onSell={sell}
          onShowPlace={(p) => {
            setPeopleOpen(false);
            setPoiId(p.id);
            controller.current?.centerOn?.(p.at);
          }}
          onClose={() => setPeopleOpen(false)}
        />
      )}
      {campaignOpen && (
        <CampaignDialog
          currentId={initial.id}
          name={name}
          onRename={setName}
          onOpen={async (id) => {
            await saveNow();
            const c = await loadCampaign(id).catch(() => null);
            if (c) onSwitch(c);
            else setMessage({ text: 'That campaign could not be opened.' });
          }}
          onNew={async (n) => {
            await saveNow();
            onSwitch(newCampaign(n, { seed, size, kind }, partyLevel));
          }}
          onExport={() => exportCampaign(snapshot())}
          onImport={async (file) => {
            try {
              const c = await importCampaignFile(file);
              // A fresh id, so an import never overwrites a campaign already saved here.
              const imported = { ...c, id: newCampaignId() };
              await saveNow();
              await saveCampaign(imported);
              onSwitch(imported);
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : 'Import failed.';
            }
          }}
          onClose={() => setCampaignOpen(false)}
        />
      )}
      <footer className="statusbar" aria-live="polite">
        <span>{shownMessage ?? pathText ?? hint}</span>
        <span>{hover ? (hoverHidden ? `Square ${hover.x}, ${hover.y} · unexplored` : `Square ${hover.x}, ${hover.y} · ${terrain}${hoverPoi ? ` · ${hoverPoi.name}` : ''}`) : ''}</span>
      </footer>
    </div>
  );
}
