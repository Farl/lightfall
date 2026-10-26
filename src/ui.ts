/**
 * Page chrome generated from config: header links, the 24h sky band under the
 * stage, and the grouped side panel (PANEL_SECTIONS), plus keyboard shortcuts.
 */
import {
  DAY_HOTKEY_HOUR,
  HOTKEYS,
  NIGHT_HOTKEY_HOUR,
  PAGE,
  PANEL_SECTIONS,
  PRESET_ORDER,
  PRESETS,
  SLIDERS,
  TIME_BAND,
  TOGGLE_AMOUNTS,
  TOGGLES,
  VIEW_MODES,
  type PanelItem,
  type SliderKey,
  type ToggleKey,
} from './config';
import { skyColorAt } from './lighting';
import type { AppState } from './state';

/** Scene editing commands the panel and hotkeys can trigger (implemented in main.ts). */
export interface EditActions {
  addBox(): void;
  removeSelected(): void;
  resetScene(): void;
}

export interface UiHandle {
  /** Re-sync every control from state (after hotkeys or drag). */
  refresh(): void;
}

export interface UiRoots {
  header: HTMLElement;
  timeBand: HTMLElement;
  panel: HTMLElement;
  shortcuts: HTMLElement;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

const toggleDef = (key: ToggleKey) => TOGGLES.find((t) => t.key === key)!;
const sliderDef = (key: SliderKey) => SLIDERS.find((s) => s.key === key)!;
const isToggle = (item: PanelItem): item is ToggleKey => TOGGLES.some((t) => t.key === item);
const isSlider = (item: PanelItem): item is SliderKey => SLIDERS.some((s) => s.key === item);

export function buildUi(roots: UiRoots, state: AppState, actions: EditActions): UiHandle {
  const syncers: (() => void)[] = [];
  const refresh = () => syncers.forEach((s) => s());

  /* ---------------------------------------------------------------- helpers */

  const range = (key: SliderKey, className = 'range') => {
    const def = sliderDef(key);
    const input = el('input', className);
    input.type = 'range';
    // Stop the browser restoring a stale slider position on reload (state would not see it).
    input.autocomplete = 'off';
    Object.assign(input, { min: def.min, max: def.max, step: def.step });
    input.setAttribute('aria-label', def.label);
    const value = el('output', 'value');
    input.oninput = () => {
      state.sliders[key] = Number(input.value);
      if (key === 'time') state.lightOverride = null;
      value.textContent = def.format(state.sliders[key]);
    };
    syncers.push(() => {
      input.value = String(state.sliders[key]);
      value.textContent = def.format(state.sliders[key]);
    });
    return { input, value };
  };

  /** Single-choice button row (presets, view modes). */
  const segmented = <K extends string>(label: string, options: { key: K; label: string }[], get: () => K, set: (k: K) => void) => {
    const group = el('div', 'segmented');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    for (const o of options) {
      const b = el('button', 'segment', o.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.onclick = () => {
        set(o.key);
        refresh();
      };
      syncers.push(() => b.setAttribute('aria-checked', String(get() === o.key)));
      group.append(b);
    }
    return group;
  };

  const row = (label: string, ...controls: HTMLElement[]) => {
    const r = el('div', 'row');
    r.append(el('span', 'row-label', label), ...controls);
    return r;
  };

  // Editing only makes sense with the proxy wireframes visible, so it turns 幾何資料 on.
  const runEdit = (run: () => void) => {
    state.toggles.debug = true;
    run();
    refresh();
  };

  /* ----------------------------------------------------------------- header */

  const titleBlock = el('div', 'title-block');
  titleBlock.append(el('h1', 'title', PAGE.title), el('p', 'subtitle', PAGE.subtitle));
  const links = el('nav', 'links');
  for (const [text, href] of [[PAGE.referenceLabel, PAGE.referenceUrl], [PAGE.repoLabel, PAGE.repoUrl]]) {
    const a = el('a', '', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    links.append(a);
  }
  roots.header.append(titleBlock, links);

  /* --------------------------------------------------------------- time band */

  const timeHead = el('div', 'time-head');
  const { input: timeInput, value: timeValue } = range('time', 'time-range');
  timeValue.className = 'time-value';
  const dayNight = el('div', 'day-night');
  for (const [label, hour] of [['日間', DAY_HOTKEY_HOUR], ['夜間', NIGHT_HOTKEY_HOUR]] as const) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.onclick = () => {
      setTime(hour);
      refresh();
    };
    dayNight.append(b);
  }
  timeHead.append(el('span', 'time-label', '時間'), timeValue, dayNight);

  const track = el('div', 'time-track');
  const def = sliderDef('time');
  const stops: string[] = [];
  for (let h = def.min; h <= def.max; h += TIME_BAND.sampleStep) {
    stops.push(`rgb(${skyColorAt(h).join(',')}) ${((h - def.min) / (def.max - def.min)) * 100}%`);
  }
  track.style.setProperty('--sky', `linear-gradient(90deg, ${stops.join(',')})`);
  const ticks = el('div', 'time-ticks');
  for (let h = def.min; h <= def.max; h += TIME_BAND.tickEvery) ticks.append(el('span', '', String(h).padStart(2, '0')));
  track.append(timeInput);
  roots.timeBand.append(timeHead, track, ticks);

  /* ------------------------------------------------------------------ panel */

  for (const section of PANEL_SECTIONS) {
    const s = el('section', 'section');
    s.append(el('h2', 'section-title', section.title));
    if (section.help) s.append(el('p', 'help', section.help));
    for (const item of section.items) s.append(panelItem(item));
    roots.panel.append(s);
  }

  function panelItem(item: PanelItem): HTMLElement {
    if (item === 'presets') return segmented('預設', PRESET_ORDER.map((k) => ({ key: k, label: PRESETS[k].label })), () => state.preset, (k) => (state.preset = k));
    if (item === 'view') {
      // Five options do not fit beside a label in the panel width, so the label sits above.
      const block = el('div', 'stacked');
      block.append(el('span', 'row-label', '檢視'), segmented('檢視', VIEW_MODES, () => state.view, (k) => (state.view = k)));
      return block;
    }
    if (item === 'edit') {
      const buttons = el('div', 'button-row');
      for (const [label, run] of [['新增方塊', actions.addBox], ['刪除選取', actions.removeSelected], ['重設場景', actions.resetScene]] as const) {
        const b = el('button', 'chip', label);
        b.type = 'button';
        b.onclick = () => runEdit(run);
        buttons.append(b);
      }
      return buttons;
    }
    if (isSlider(item)) {
      const { input, value } = range(item);
      return row(sliderDef(item).label, input, value);
    }
    if (isToggle(item)) {
      const t = toggleDef(item);
      const input = el('input', 'switch');
      input.type = 'checkbox';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', t.label);
      input.onchange = () => {
        state.toggles[item] = input.checked;
        refresh();
      };
      syncers.push(() => (input.checked = state.toggles[item]));
      const r = el('label', 'row toggle-row');
      r.append(input, el('span', 'row-label', t.label));
      const amount = TOGGLE_AMOUNTS[item];
      if (amount) {
        const { input: slider, value } = range(amount);
        syncers.push(() => r.classList.toggle('is-off', !state.toggles[item]));
        r.append(slider, value);
      }
      return r;
    }
    throw new Error(`Unknown panel item ${item}`);
  }

  /* ---------------------------------------------------------------- hotkeys */

  for (const [key, label] of PAGE.shortcuts) {
    const k = el('span', 'shortcut');
    k.append(el('kbd', '', key), document.createTextNode(label));
    roots.shortcuts.append(k);
  }

  const setTime = (hour: number) => {
    state.sliders.time = hour;
    state.lightOverride = null;
  };
  const toggle = (key: ToggleKey) => (state.toggles[key] = !state.toggles[key]);

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    const presetIndex = HOTKEYS.presets.indexOf(k);
    if (presetIndex >= 0) state.preset = PRESET_ORDER[presetIndex];
    else if (k === HOTKEYS.day) setTime(DAY_HOTKEY_HOUR);
    else if (k === HOTKEYS.night) setTime(NIGHT_HOTKEY_HOUR);
    else if (k === HOTKEYS.pause) toggle('animate');
    else if (k === HOTKEYS.debug) toggle('debug');
    else if (k === HOTKEYS.addBox) runEdit(actions.addBox);
    else if (HOTKEYS.removeBox.includes(k)) runEdit(actions.removeSelected);
    else return;
    refresh();
  });

  refresh();
  return { refresh };
}
