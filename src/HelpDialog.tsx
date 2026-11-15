import { useEffect, useRef, useState } from 'react';

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Getting started',
    body: (
      <ol>
        <li>Your campaign opens with a demo party at the dungeon entrance. Everything saves itself in this browser.</li>
        <li>
          <strong>New map</strong> makes a tavern, dungeon, cave, town, forest, city or wilderness. Pick a size, then a type.
        </li>
        <li>Click a hero, then click a square to walk there. The highlighted squares are how far they can still move.</li>
        <li>
          Press <kbd>N</kbd> for the next round (everyone's movement resets).
        </li>
        <li>
          When you play online, click <strong>Player screen</strong> and share that window in Discord.
        </li>
      </ol>
    ),
  },
  {
    title: 'Moving tokens',
    body: (
      <ul>
        <li>Click a token to select it; click a square to move. Hover first to see the path and its cost in feet.</li>
        <li>Shift-click moves anywhere, ignoring the rules (DM override). Undo move is in the Tokens panel.</li>
        <li>Arrow keys move the selected token one square (Home, PgUp, End, PgDn for diagonals). With nothing selected they pan the map.</li>
        <li>Scroll or pinch to zoom; drag to pan; 0 fits the map.</li>
        <li>Rules follow D&amp;D 2024: every square is 5 ft, difficult terrain costs double, no cutting corners, and you can move through allies but not end in their space.</li>
      </ul>
    ),
  },
  {
    title: 'Doors, fog and Player view',
    body: (
      <ul>
        <li>Click or right-click a door to open or close it; press O next to one. Shift-click locks or unlocks it.</li>
        <li>Fog of war hides what the party hasn't seen. Dim squares were seen before; clear squares are in sight now.</li>
        <li>
          <strong>Preview as players</strong> shows this window exactly as the players see it. <strong>Player screen</strong> opens it as a separate window with no controls, for sharing.
        </li>
        <li>The player screen follows this window: moves, doors, fog and names update as you play. Keep both windows in the same browser.</li>
      </ul>
    ),
  },
  {
    title: 'Places and people',
    body: (
      <ul>
        <li>Towns, cities and wilderness have named places, each with its own symbol. Click one for its card. ◆ marks the way in.</li>
        <li>
          <strong>Go inside</strong> on the card, or select a hero by the ◆ and press <kbd>E</kbd>, to enter. The inside is made the first time. <kbd>E</kbd> at the way out, or Leave, goes back.
        </li>
        <li>Click a person's token (dashed ring) for their NPC card: attitude, wants, secrets, rumors, and what they sell.</li>
        <li>Players see a description ("Soot-streaked smith") until you tick Introduced.</li>
        <li>Places with a dashed badge are hidden from players until you untick Hidden.</li>
        <li>People &amp; places lists everyone in the campaign, with search.</li>
      </ul>
    ),
  },
  {
    title: 'Combat',
    body: (
      <ul>
        <li>Start combat rolls initiative for the party and every creature they can see. Edit any roll in the list.</li>
        <li>
          <kbd>N</kbd> or End turn passes to the next creature and selects it. End combat goes back to exploring.
        </li>
        <li>Open a token's Stats &amp; conditions for HP (Damage, Heal), conditions and abilities. HP bars only show in the DM view.</li>
        <li>Unseen monsters may wander between rounds. Guards stay near their home.</li>
      </ul>
    ),
  },
  {
    title: 'Loot and the Library',
    body: (
      <ul>
        <li>Chests are stocked for the party level. With nothing selected, click a chest to see it and hand items out.</li>
        <li>Defeated creatures drop what they carried. Shopkeepers' cards have a Sell to… list.</li>
        <li>The Library holds your creatures and items. Add quest and lore items there; mark them Unique or keep them out of random loot.</li>
      </ul>
    ),
  },
  {
    title: 'Saving and campaigns',
    body: (
      <ul>
        <li>Saving is automatic (✓ Saved, top right). It stays in this browser on this computer.</li>
        <li>Campaign → Export to file makes a backup you can import on another computer.</li>
        <li>The Map menu lists every map in the campaign. Looking at another map doesn't move the party.</li>
      </ul>
    ),
  },
  {
    title: 'Keyboard',
    body: (
      <table className="keys">
        <tbody>
          {[
            ['N', 'Next round / next turn'],
            ['E', 'Go in or out (selected hero by an entrance)'],
            ['O', 'Open or close a door next to the selected token'],
            ['Arrows', 'Move the selected token, or pan'],
            ['Shift-click', 'DM move or lock a door'],
            ['Esc', 'Deselect'],
            ['0', 'Fit the map'],
            ['+ / −', 'Zoom'],
          ].map(([k, v]) => (
            <tr key={k}>
              <th>
                <kbd>{k}</kbd>
              </th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
];

/** The how-to screen. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="library help-dialog" onClose={onClose} aria-label="How to use">
      <header>
        <h2>How to use</h2>
        <span className="spacer" />
        <button type="button" onClick={() => ref.current?.close()}>
          Close
        </button>
      </header>
      <div className="lib-body">
        <nav className="lib-list" aria-label="Topics">
          <ul>
            {SECTIONS.map((s, i) => (
              <li key={s.title}>
                <button type="button" className={`lib-item${i === tab ? ' on' : ''}`} aria-current={i === tab} onClick={() => setTab(i)}>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="lib-detail help-body">
          <h3>{SECTIONS[tab].title}</h3>
          {SECTIONS[tab].body}
        </div>
      </div>
    </dialog>
  );
}
