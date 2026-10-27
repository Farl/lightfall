/**
 * Room Atmosphere 2D — a flat pixel-art room relit with fake 2.5D lighting.
 * See docs/technique.md for how the pieces fit together.
 */
import { ART, RENDER } from './config';
import { DustField } from './dust';
import { lightingAt } from './lighting';
import { DebugOverlay } from './overlay';
import { Renderer } from './render/renderer';
import { SceneLayers } from './scene/layers';
import { addBox, removeGroup, resetRoom } from './scene/editing';
import { ROOM_DATA } from './scene/roomData';
import { createState } from './state';
import { buildUi } from './ui';

/** Clamp long frames (tab switches) so the dust does not teleport. */
const MAX_FRAME_DT = 0.1;

function start() {
  const state = createState();
  // Rebuilds are batched to one per frame however many pointer events arrive.
  let sceneDirty = false;
  const markDirty = () => (sceneDirty = true);
  // Working copy: editing mutates this, ROOM_DATA stays the pristine source for 重設場景 (reset scene).
  const room = structuredClone(ROOM_DATA);
  const layers = new SceneLayers();
  layers.build(room);

  // The AI repaint loads asynchronously; until then (or with AI art off) the flat painting shows.
  const aiPainting = new Image();
  let aiReady = false;
  aiPainting.onload = () => {
    aiReady = true;
    markDirty();
  };
  aiPainting.src = ART.aiAlbedo;
  let builtWithAi = false;

  const renderer = new Renderer(document.querySelector<HTMLCanvasElement>('#view')!, layers, room);
  const dust = new DustField();

  const overlay = new DebugOverlay(document.querySelector<HTMLCanvasElement>('#overlay')!, room, {
    onLightDrag: (toLight) => (state.lightOverride = toLight),
    onEdit: markDirty,
  });
  const select = (group: string | null) => (overlay.selected = group);
  const byId = (id: string) => document.getElementById(id)!;
  buildUi({ header: byId('header'), toolbar: byId('stage-toolbar'), timeBand: byId('time-band'), panel: byId('panel'), shortcuts: byId('shortcuts') }, state, {
    addBox: () => {
      select(addBox(room, RENDER.maxBoxes));
      markDirty();
    },
    removeSelected: () => {
      if (!overlay.selected) return;
      removeGroup(room, overlay.selected);
      select(null);
      markDirty();
    },
    resetScene: () => {
      resetRoom(room, ROOM_DATA);
      select(null);
      markDirty();
    },
  });

  // Exposed for console inspection / automated checks.
  Object.assign(window, { app: { state, layers, renderer, room, overlay } });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
    last = now;
    if (state.toggles.animate) state.clock += dt;

    const useAi = state.toggles.aiArt && aiReady;
    if (sceneDirty || useAi !== builtWithAi) {
      layers.build(room, useAi ? aiPainting : null);
      builtWithAi = useAi;
      renderer.setScene(layers, room);
      sceneDirty = false;
    }

    const light = lightingAt(state.sliders.time, state.lightOverride);
    if (state.toggles.dust) {
      if (state.toggles.animate) dust.update(dt, state.sliders.dustSpeed, state.clock);
      dust.draw(layers, room, light.toLight, state.clock);
    }
    renderer.render(state, light, dust.canvas);

    overlay.draw(light.toLight, { edit: state.toggles.edit, geometry: state.toggles.geometry });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try {
  start();
} catch (err) {
  const box = document.querySelector<HTMLElement>('#error')!;
  box.hidden = false;
  box.textContent = String(err instanceof Error ? err.message : err);
  throw err;
}
