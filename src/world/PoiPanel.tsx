import type { Npc, PoiObject } from '../core/model/types';
import { POI_INFO } from '../core/world/poi';
import { npcDisplayName } from '../core/world/npcs';

interface Props {
  poi: PoiObject;
  people: Npc[];
  playerView: boolean;
  onChange: (patch: Partial<PoiObject>) => void;
  onEnter: () => void;
  onOpenNpc: (npc: Npc) => void;
  onClose: () => void;
}

/** A place: its name, what players learn there, DM notes, who's there, and the way in. */
export function PoiPanel({ poi, people, playerView, onChange, onEnter, onOpenNpc, onClose }: Props) {
  const info = POI_INFO[poi.poiType];
  const inside = info.inside;
  const enterLabel = !inside ? null : 'underground' in inside ? (poi.link ? 'Go down' : 'Go down (creates the map)') : poi.link ? 'Go inside' : 'Go inside (creates the map)';
  const hidden = poi.visibility === 'dm';
  return (
    <section className="poi-panel" aria-label={poi.name}>
      <header>
        <h2>{poi.name}</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="fine">
        {info.label}
        {hidden && !playerView ? ' · hidden from players' : ''}
      </p>
      {playerView ? (
        <p>{poi.description}</p>
      ) : (
        <div className="npc-fields">
          <label className="wide">
            Name
            <input value={poi.name} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label className="wide">
            What players see
            <textarea rows={2} value={poi.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} />
          </label>
          <label className="wide">
            DM notes
            <textarea rows={2} value={poi.dmNotes ?? ''} onChange={(e) => onChange({ dmNotes: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={hidden} onChange={(e) => onChange({ visibility: e.target.checked ? 'dm' : 'public' })} /> Hidden from players
          </label>
          {hidden && (
            <label>
              Search DC
              <input type="number" min={5} max={30} value={poi.searchDc ?? ''} onChange={(e) => onChange({ searchDc: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </label>
          )}
        </div>
      )}
      {people.length > 0 && (
        <>
          <h3>People here</h3>
          <ul className="people-list">
            {people.map((n) => (
              <li key={n.id}>
                <button type="button" className="link-button" onClick={() => onOpenNpc(n)}>
                  {playerView ? npcDisplayName(n) : n.name}
                </button>
                {!playerView && <small> {n.occupation.toLowerCase()} · {n.attitude}</small>}
              </li>
            ))}
          </ul>
        </>
      )}
      {enterLabel && !playerView && (
        <div className="row">
          <button type="button" className="primary" onClick={onEnter}>
            {enterLabel}
          </button>
        </div>
      )}
      {enterLabel && !playerView && <p className="fine">The whole party goes in. Or select a hero by the door and press E.</p>}
    </section>
  );
}
