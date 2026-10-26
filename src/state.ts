/** Mutable app state, initialised from the UI definitions in config.ts. */
import { DEFAULT_PRESET, SLIDERS, TOGGLES, type PresetKey, type SliderKey, type ToggleKey, type ViewMode } from './config';
import type { Vec3 } from './math';

export interface AppState {
  preset: PresetKey;
  view: ViewMode;
  toggles: Record<ToggleKey, boolean>;
  sliders: Record<SliderKey, number>;
  /** Set by dragging the landing point; cleared when the time slider moves. */
  lightOverride: Vec3 | null;
  /** Accumulated animation clock (stops while 動態空氣 is off). */
  clock: number;
}

export function createState(): AppState {
  return {
    preset: DEFAULT_PRESET,
    view: 'final',
    toggles: Object.fromEntries(TOGGLES.map((t) => [t.key, t.initial])) as Record<ToggleKey, boolean>,
    sliders: Object.fromEntries(SLIDERS.map((s) => [s.key, s.initial])) as Record<SliderKey, number>,
    lightOverride: null,
    clock: 0,
  };
}
