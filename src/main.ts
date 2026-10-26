/**
 * Room Atmosphere 2D — a flat pixel-art room relit with fake 2.5D lighting.
 * See docs/technique.md for how the pieces fit together.
 */
import { DustField } from './dust';
import { lightingAt } from './lighting';
import { DebugOverlay } from './overlay';
import { Renderer } from './render/renderer';
import { SceneLayers } from './scene/layers';
import { ROOM_DATA } from './scene/roomData';
import { createState } from './state';
import { buildUi } from './ui';

/** Clamp long frames (tab switches) so the dust does not teleport. */
const MAX_FRAME_DT = 0.1;

function start() {
  const state = createState();
  const layers = new SceneLayers();
  layers.build(ROOM_DATA);

  const renderer = new Renderer(document.querySelector<HTMLCanvasElement>('#view')!, layers, ROOM_DATA);
  const dust = new DustField();
  const ui = buildUi(document.querySelector('#panel')!, state);
  const overlay = new DebugOverlay(document.querySelector<HTMLCanvasElement>('#overlay')!, ROOM_DATA, (toLight) => {
    state.lightOverride = toLight;
    ui.refresh();
  });

  // Exposed for console inspection / automated checks.
  Object.assign(window, { app: { state, layers, renderer } });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
    last = now;
    if (state.toggles.animate) state.clock += dt;

    const light = lightingAt(state.sliders.time, state.lightOverride);
    if (state.toggles.dust) {
      if (state.toggles.animate) dust.update(dt, state.sliders.dustSpeed, state.clock);
      dust.draw(layers, ROOM_DATA, light.toLight, state.clock);
    }
    renderer.render(state, light, dust.canvas);

    overlay.setVisible(state.toggles.debug);
    if (state.toggles.debug) overlay.draw(light.toLight);
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
