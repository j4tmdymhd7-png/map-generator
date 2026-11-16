import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point } from '../core/model/types';
import { drawFog } from '../renderer/fogLayer';
import { MapView, type MapViewController } from '../renderer/MapView';
import { drawPois } from '../renderer/poiLayer';
import { drawTokens } from '../renderer/tokens';
import type { Viewport } from '../renderer/viewport';
import { openChannel, type PlayerMessage } from './channel';

type State = Extract<PlayerMessage, { type: 'state' }>;

/**
 * The window you share on Discord: the map as the players know it, with no
 * DM controls. Everything it shows comes from the DM window.
 */
export function PlayerScreen() {
  const [state, setState] = useState<State | null>(null);
  const [gone, setGone] = useState(false);
  const anim = useRef<{ id: string; pos: Point } | null>(null);
  const controller = useRef<MapViewController | null>(null);
  const requestDraw = useCallback(() => controller.current?.requestDraw(), []);

  useEffect(() => {
    const ch = openChannel();
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<PlayerMessage>) => {
      const m = e.data;
      if (m.type === 'state') {
        setState(m);
        setGone(false);
      } else if (m.type === 'anim') {
        anim.current = m.anim;
        controller.current?.requestDraw();
      } else if (m.type === 'bye') setGone(true);
    };
    ch.postMessage({ type: 'hello' } satisfies PlayerMessage);
    return () => ch.close();
  }, []);

  useEffect(() => {
    document.title = state ? `Players · ${state.map.title}` : 'Player screen';
    requestDraw();
  }, [state, requestDraw]);

  if (!state)
    return (
      <div className="player-screen waiting">
        <p>Waiting for the DM’s window…</p>
        <p className="fine">Open this from the DM window with the Player screen button. Keep both windows in the same browser.</p>
      </div>
    );

  const overlay = (ctx: CanvasRenderingContext2D, v: Viewport) => {
    drawPois(ctx, v, state.pois, { playerView: true, selectedId: null });
    if (state.fog) drawFog(ctx, v, state.fog, state.map.width, state.map.height, 'players');
    drawTokens(ctx, v, state.tokens, { selectedId: null, animating: anim.current, onImageLoad: requestDraw, showHp: false, activeId: state.activeId });
  };

  return (
    <div className="player-screen">
      <MapView map={state.map} showGrid roomNumbers={false} palette={state.palette} overlay={overlay} controllerRef={controller} />
      <div className="player-caption" aria-live="polite">
        {state.map.title}
        {gone && <span> · DM window closed</span>}
      </div>
    </div>
  );
}
