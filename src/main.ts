/**
 * 光隙 · Lightfall — flat pixel art relit with fake 2.5D lighting:
 * light through windows, branches and tracery.
 * See docs/technique.md for how the pieces fit together.
 */
import { RENDER, TIME_PLAY } from './config';
import { DustField } from './dust';
import { lightingAt } from './lighting';
import { DebugOverlay } from './overlay';
import { Renderer } from './render/renderer';
import { SceneLayers } from './scene/layers';
import { addBox, removeGroup, resetRoom } from './scene/editing';
import { atmosphereOf, SCENES } from './scene/scenes';
import { createState } from './state';
import { buildUi } from './ui';

/** Clamp long frames (tab switches) so the dust does not teleport. */
const MAX_FRAME_DT = 0.1;

function start() {
  const state = createState();
  // Rebuilds are batched to one per frame however many pointer events arrive.
  let sceneDirty = false;
  const markDirty = () => (sceneDirty = true);
  const sceneDef = () => SCENES[state.scene];
  // Working copy: editing mutates this, SCENES[...].data stays the pristine source for 重設場景 (reset scene).
  // A scene switch overwrites it in place, so the overlay and renderer keep the same reference.
  const room = structuredClone(sceneDef().data);
  let builtScene = state.scene;
  const layers = new SceneLayers();
  layers.build(room);

  // Repainted base art loads asynchronously; until then (or with AI art off) the flat painting shows.
  const paintings = new Map<string, HTMLImageElement>();
  const paintingFor = (src: string | undefined) => {
    if (!src) return null;
    let img = paintings.get(src);
    if (!img) {
      img = new Image();
      img.onload = markDirty;
      img.src = src;
      paintings.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  };
  let builtPainting: HTMLImageElement | null = null;

  const renderer = new Renderer(document.querySelector<HTMLCanvasElement>('#view')!, layers, room, sceneDef());
  const dust = new DustField();
  const resetDust = () => dust.reset(room.bounds, atmosphereOf(sceneDef()).dustCount);
  resetDust();

  const overlay = new DebugOverlay(document.querySelector<HTMLCanvasElement>('#overlay')!, room, {
    onLightDrag: (toLight) => (state.lightOverride = toLight),
    onEdit: markDirty,
  });
  const select = (group: string | null) => (overlay.selected = group);
  const byId = (id: string) => document.getElementById(id)!;
  const ui = buildUi({ header: byId('header'), toolbar: byId('stage-toolbar'), timeBand: byId('time-band'), panel: byId('panel'), shortcuts: byId('shortcuts') }, state, {
    addBox: () => {
      select(addBox(room, RENDER.maxBoxes, sceneDef().boxSpawn));
      markDirty();
    },
    removeSelected: () => {
      if (!overlay.selected) return;
      removeGroup(room, overlay.selected);
      select(null);
      markDirty();
    },
    resetScene: () => {
      resetRoom(room, sceneDef().data);
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
    if (state.playing) {
      state.sliders.time = (state.sliders.time + dt * TIME_PLAY.hoursPerSecond) % 24;
      state.lightOverride = null;
      ui.refreshTime();
    }

    if (state.scene !== builtScene) {
      resetRoom(room, sceneDef().data);
      builtScene = state.scene;
      select(null);
      state.lightOverride = null;
      resetDust();
      sceneDirty = true;
    }
    const painting = state.toggles.aiArt ? paintingFor(sceneDef().art) : null;
    if (sceneDirty || painting !== builtPainting) {
      layers.build(room, painting);
      builtPainting = painting;
      renderer.setScene(layers, room, sceneDef());
      sceneDirty = false;
    }

    const light = lightingAt(state.sliders.time, state.lightOverride, sceneDef(), room.lamps.length > 0);
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
