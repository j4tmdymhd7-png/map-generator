import { useEffect, useRef, useState } from 'react';
import type { ItemDef } from '../core/loot/items';
import { NAME_STYLES, type DungeonMap, type NameStyle, type Npc, type PoiObject, type Token } from '../core/model/types';
import { NAME_STYLE_LABEL } from '../core/world/names';
import { POI_INFO } from '../core/world/poi';
import { NpcCard } from './NpcCard';

interface Props {
  npcs: Npc[];
  maps: DungeonMap[];
  current: DungeonMap;
  items: ItemDef[];
  party: Token[];
  nameStyle: NameStyle;
  onNameStyle: (s: NameStyle) => void;
  onChangeNpc: (id: string, patch: Partial<Npc>) => void;
  onNewNpc: () => Npc;
  onDeleteNpc: (id: string) => void;
  onSell: (item: ItemDef, to: Token) => void;
  /** Close the dialog and show this place on the map. */
  onShowPlace: (poi: PoiObject) => void;
  onClose: () => void;
}

/** Every place on this map and every NPC in the campaign, with their cards. */
export function PeopleDialog({ npcs, maps, current, items, party, nameStyle, onNameStyle, onChangeNpc, onNewNpc, onDeleteNpc, onSell, onShowPlace, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'people' | 'places'>('people');
  const [scope, setScope] = useState<'map' | 'all'>('map');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const pois = current.objects.filter((o): o is PoiObject => o.kind === 'poi');
  const allPois = new Map(maps.flatMap((m) => m.objects.filter((o): o is PoiObject => o.kind === 'poi').map((p) => [p.id, { poi: p, map: m }] as const)));
  // An NPC belongs to this map if they work here, or at a place whose interior this is.
  const onThisMap = (n: Npc) => n.mapId === current.id || (current.parent && n.workPoiId === current.parent.poiId);
  const q = query.trim().toLowerCase();
  const shown = npcs
    .filter((n) => scope === 'all' || onThisMap(n))
    .filter((n) => !q || `${n.name} ${n.occupation} ${n.descriptor}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const open = npcs.find((n) => n.id === openId) ?? null;
  const placeName = (n: Npc) => (n.workPoiId ? allPois.get(n.workPoiId)?.poi.name : undefined);

  return (
    <dialog ref={ref} className="library" onClose={onClose} aria-label="People and places">
      <header>
        <h2>People &amp; places</h2>
        <div role="tablist" className="tabs">
          <button role="tab" type="button" aria-selected={tab === 'people'} onClick={() => setTab('people')}>
            People ({npcs.length})
          </button>
          <button role="tab" type="button" aria-selected={tab === 'places'} onClick={() => setTab('places')}>
            Places on this map ({pois.length})
          </button>
        </div>
        <label className="inline">
          Names{' '}
          <select value={nameStyle} onChange={(e) => onNameStyle(e.target.value as NameStyle)} title="Name style for newly generated people and places">
            {NAME_STYLES.map((s) => (
              <option key={s} value={s}>
                {NAME_STYLE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close people and places">
          Close
        </button>
      </header>
      {tab === 'people' ? (
        <div className="lib-body">
          <div className="lib-list">
            <div className="row">
              <input type="search" placeholder="Search names, jobs…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
              <select value={scope} onChange={(e) => setScope(e.target.value as 'map' | 'all')} aria-label="Which people">
                <option value="map">This map</option>
                <option value="all">Everyone</option>
              </select>
            </div>
            <ul>
              {shown.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`lib-item${n.id === openId ? ' on' : ''}`} onClick={() => setOpenId(n.id)}>
                    <span>{n.name}</span>
                    <small>
                      {n.occupation}
                      {placeName(n) ? ` · ${placeName(n)}` : ''} · {n.attitude}
                      {n.known ? ' · introduced' : ''}
                    </small>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="fine">No one here yet. Towns and wilderness maps come with people.</li>}
            </ul>
            <button type="button" onClick={() => setOpenId(onNewNpc().id)}>
              + New NPC
            </button>
          </div>
          <div className="lib-detail">
            {open ? (
              <NpcCard
                key={open.id}
                npc={open}
                playerView={false}
                items={items}
                party={party}
                placeName={placeName(open)}
                onChange={(patch) => onChangeNpc(open.id, patch)}
                onSell={onSell}
                onDelete={() => {
                  onDeleteNpc(open.id);
                  setOpenId(null);
                }}
              />
            ) : (
              <p className="fine">Pick someone to see their card.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="lib-detail">
          {pois.length === 0 ? (
            <p className="fine">No named places on this map. Towns, cities and wilderness maps have them.</p>
          ) : (
            <ul className="place-list">
              {[...pois]
                .sort((a, b) => POI_INFO[a.poiType].label.localeCompare(POI_INFO[b.poiType].label) || a.name.localeCompare(b.name))
                .map((p) => (
                  <li key={p.id}>
                    <button type="button" className="link-button" onClick={() => onShowPlace(p)}>
                      {p.name}
                    </button>{' '}
                    <small>
                      {POI_INFO[p.poiType].label}
                      {p.visibility === 'dm' ? ' · hidden' : ''}
                      {p.link ? ' · visited' : ''} · {npcs.filter((n) => n.workPoiId === p.id).length} people
                    </small>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </dialog>
  );
}
