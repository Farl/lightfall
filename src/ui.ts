/**
 * Page chrome generated from config: header (links, language switch), the
 * geometry toolbar and 24h sky band under the stage, the grouped side panel
 * (PANEL_SECTIONS), and keyboard shortcuts.
 *
 * Every visible string is a config `Text` bound through `bindText`, so switching
 * language is just setLocale + refresh: no DOM is rebuilt.
 */
import {
  DAY_HOTKEY_HOUR,
  HOTKEYS,
  I18N,
  LOCALES,
  NIGHT_HOTKEY_HOUR,
  PAGE,
  PANEL_SECTIONS,
  PRESET_ORDER,
  PRESETS,
  SLIDERS,
  STAGE_TOOLBAR,
  TIME_BAND,
  TOGGLE_AMOUNTS,
  TOGGLES,
  UI_TEXT,
  VIEW_MODES,
  type PanelItem,
  type SliderKey,
  type Text,
  type ToggleKey,
} from './config';
import { applyDocumentLocale, locale, setLocale, t } from './i18n';
import { skyColorAt } from './lighting';
import type { AppState } from './state';

/** Scene editing commands the toolbar and hotkeys can trigger (implemented in main.ts). */
export interface EditActions {
  addBox(): void;
  removeSelected(): void;
  resetScene(): void;
}

export interface UiHandle {
  /** Re-sync every control and string from state and locale (after hotkeys or drag). */
  refresh(): void;
}

export interface UiRoots {
  header: HTMLElement;
  toolbar: HTMLElement;
  timeBand: HTMLElement;
  panel: HTMLElement;
  shortcuts: HTMLElement;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
};

const button = (className: string) => {
  const b = el('button', className);
  b.type = 'button';
  return b;
};

/** The same string in every locale. */
const untranslated = (s: string) => Object.fromEntries(LOCALES.map((l) => [l, s])) as Text;

const toggleDef =(key: ToggleKey) => TOGGLES.find((t) => t.key === key)!;
const sliderDef = (key: SliderKey) => SLIDERS.find((s) => s.key === key)!;
const isToggle = (item: PanelItem): item is ToggleKey => TOGGLES.some((t) => t.key === item);
const isSlider = (item: PanelItem): item is SliderKey => SLIDERS.some((s) => s.key === item);

export function buildUi(roots: UiRoots, state: AppState, actions: EditActions): UiHandle {
  const syncers: (() => void)[] = [];
  const refresh = () => syncers.forEach((s) => s());

  /* ---------------------------------------------------------------- helpers */

  /** Element whose text follows the current locale. */
  const bindText = <E extends HTMLElement>(e: E, text: Text) => {
    syncers.push(() => (e.textContent = t(text)));
    return e;
  };
  const textEl = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: Text) => bindText(el(tag, className), text);
  const bindAria = (e: HTMLElement, text: Text) => syncers.push(() => e.setAttribute('aria-label', t(text)));

  const range = (key: SliderKey, className = 'range') => {
    const def = sliderDef(key);
    const input = el('input', className);
    input.type = 'range';
    // Stop the browser restoring a stale slider position on reload (state would not see it).
    input.autocomplete = 'off';
    Object.assign(input, { min: def.min, max: def.max, step: def.step });
    bindAria(input, def.label);
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

  /** Single-choice button row (presets, view modes, language). */
  const segmented = <K extends string>(label: Text, options: { key: K; label: Text }[], get: () => K, set: (k: K) => void) => {
    const group = el('div', 'segmented');
    group.setAttribute('role', 'radiogroup');
    bindAria(group, label);
    for (const o of options) {
      const b = bindText(button('segment'), o.label);
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

  const row = (label: Text, ...controls: HTMLElement[]) => {
    const r = el('div', 'row');
    r.append(textEl('span', 'row-label', label), ...controls);
    return r;
  };

  // Edit commands only make sense while interacting with the scene, so they turn 編輯 on.
  const runEdit = (run: () => void) => {
    state.toggles.edit = true;
    run();
    refresh();
  };

  /* ----------------------------------------------------------------- header */

  const titleBlock = el('div', 'title-block');
  titleBlock.append(textEl('h1', 'title', PAGE.title), textEl('p', 'subtitle', PAGE.subtitle));
  const links = el('nav', 'links');
  for (const [text, href] of [[PAGE.referenceLabel, PAGE.referenceUrl], [PAGE.repoLabel, PAGE.repoUrl]] as const) {
    const a = textEl('a', '', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    links.append(a);
  }
  // Each language is named in its own language whatever the current locale.
  const languages = segmented(UI_TEXT.language, LOCALES.map((l) => ({ key: l, label: untranslated(I18N.names[l]) })), locale, setLocale);
  languages.classList.add('languages');
  links.append(languages);
  roots.header.append(titleBlock, links);

  /* ---------------------------------------------------------------- toolbar */

  // On-stage geometry controls: never inside the scrolling panel.
  roots.toolbar.setAttribute('role', 'toolbar');
  bindAria(roots.toolbar, UI_TEXT.toolbar);
  for (const key of STAGE_TOOLBAR) {
    const b = bindText(button('chip toggle-chip'), toggleDef(key).label);
    b.onclick = () => {
      toggle(key);
      refresh();
    };
    syncers.push(() => b.setAttribute('aria-pressed', String(state.toggles[key])));
    roots.toolbar.append(b);
  }
  const editTools = el('div', 'edit-tools');
  for (const [label, run] of [[UI_TEXT.addBox, actions.addBox], [UI_TEXT.removeSelected, actions.removeSelected], [UI_TEXT.resetScene, actions.resetScene]] as const) {
    const b = bindText(button('chip'), label);
    b.onclick = () => runEdit(run);
    editTools.append(b);
  }
  editTools.append(textEl('p', 'help', UI_TEXT.editHint));
  syncers.push(() => (editTools.hidden = !state.toggles.edit));
  roots.toolbar.append(editTools);

  /* --------------------------------------------------------------- time band */

  const timeHead = el('div', 'time-head');
  const { input: timeInput, value: timeValue } = range('time', 'time-range');
  timeValue.className = 'time-value';
  const dayNight = el('div', 'day-night');
  for (const [label, hour] of [[UI_TEXT.day, DAY_HOTKEY_HOUR], [UI_TEXT.night, NIGHT_HOTKEY_HOUR]] as const) {
    const b = bindText(button('chip'), label);
    b.onclick = () => {
      setTime(hour);
      refresh();
    };
    dayNight.append(b);
  }
  timeHead.append(textEl('span', 'time-label', UI_TEXT.time), timeValue, dayNight);

  const track = el('div', 'time-track');
  const def = sliderDef('time');
  const stops: string[] = [];
  for (let h = def.min; h <= def.max; h += TIME_BAND.sampleStep) {
    stops.push(`rgb(${skyColorAt(h).join(',')}) ${((h - def.min) / (def.max - def.min)) * 100}%`);
  }
  track.style.setProperty('--sky', `linear-gradient(90deg, ${stops.join(',')})`);
  const ticks = el('div', 'time-ticks');
  for (let h = def.min; h <= def.max; h += TIME_BAND.tickEvery) {
    const tick = el('span');
    tick.textContent = String(h).padStart(2, '0');
    ticks.append(tick);
  }
  track.append(timeInput);
  roots.timeBand.append(timeHead, track, ticks);

  /* ------------------------------------------------------------------ panel */

  bindAria(roots.panel, UI_TEXT.panel);
  for (const section of PANEL_SECTIONS) {
    const s = el('section', 'section');
    s.append(textEl('h2', 'section-title', section.title));
    for (const item of section.items) s.append(panelItem(item));
    roots.panel.append(s);
  }

  function panelItem(item: PanelItem): HTMLElement {
    if (item === 'presets') return segmented(UI_TEXT.presets, PRESET_ORDER.map((k) => ({ key: k, label: PRESETS[k].label })), () => state.preset, (k) => (state.preset = k));
    if (item === 'view') {
      // Five options do not fit beside a label in the panel width, so the label sits above.
      const block = el('div', 'stacked');
      block.append(textEl('span', 'row-label', UI_TEXT.view), segmented(UI_TEXT.view, VIEW_MODES, () => state.view, (k) => (state.view = k)));
      return block;
    }
    if (isSlider(item)) {
      const { input, value } = range(item);
      return row(sliderDef(item).label, input, value);
    }
    if (isToggle(item)) {
      const def = toggleDef(item);
      const input = el('input', 'switch');
      input.type = 'checkbox';
      input.autocomplete = 'off';
      bindAria(input, def.label);
      input.onchange = () => {
        state.toggles[item] = input.checked;
        refresh();
      };
      syncers.push(() => (input.checked = state.toggles[item]));
      const r = el('label', 'row toggle-row');
      r.append(input, textEl('span', 'row-label', def.label));
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
    const kbd = el('kbd');
    kbd.textContent = key;
    k.append(kbd, textEl('span', '', label));
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
    else if (k === HOTKEYS.edit) toggle('edit');
    else if (k === HOTKEYS.geometry) toggle('geometry');
    else if (k === HOTKEYS.addBox) runEdit(actions.addBox);
    else if (HOTKEYS.removeBox.includes(k)) runEdit(actions.removeSelected);
    else return;
    refresh();
  });

  // Locale switches re-run every text syncer; the document title follows too.
  syncers.push(applyDocumentLocale);
  refresh();
  return { refresh };
}
