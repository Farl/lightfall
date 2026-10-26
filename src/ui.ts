/** Control panel generated from the PRESETS / TOGGLES / SLIDERS / VIEW_MODES definitions, plus hotkeys. */
import { DAY_HOTKEY_HOUR, HOTKEYS, NIGHT_HOTKEY_HOUR, PRESET_ORDER, PRESETS, SLIDERS, TOGGLES, VIEW_MODES, type ToggleKey } from './config';
import type { AppState } from './state';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

export interface UiHandle {
  /** Re-sync every control from state (after hotkeys or drag). */
  refresh(): void;
}

export function buildUi(root: HTMLElement, state: AppState): UiHandle {
  const syncers: (() => void)[] = [];
  const refresh = () => syncers.forEach((s) => s());

  const hint = el('div', 'hint', `區域氣氛預覽 | 1-3 切換  D 日間 / N 夜間  P 暫停動態  G 幾何資料`);
  const rowPresets = el('div', 'row');
  const rowToggles = el('div', 'row');
  const rowSliders = el('div', 'row');
  root.append(hint, rowPresets, rowToggles, rowSliders);

  PRESET_ORDER.forEach((key, i) => {
    const b = el('button', 'preset', `${i + 1}  ${PRESETS[key].label}`);
    b.onclick = () => {
      state.preset = key;
      refresh();
    };
    syncers.push(() => b.classList.toggle('active', state.preset === key));
    rowPresets.append(b);
  });

  const view = el('select', 'view');
  for (const m of VIEW_MODES) view.append(new Option(m.label, m.key));
  view.onchange = () => (state.view = view.value as AppState['view']);
  syncers.push(() => (view.value = state.view));
  rowPresets.append(labelled('檢視', view));

  for (const t of TOGGLES) {
    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.autocomplete = 'off';
    input.onchange = () => (state.toggles[t.key] = input.checked);
    syncers.push(() => (input.checked = state.toggles[t.key]));
    rowToggles.append(labelled(t.label, input));
  }

  for (const s of SLIDERS) {
    const input = el('input');
    input.type = 'range';
    // Stop the browser restoring a stale slider position on reload (state would not see it).
    input.autocomplete = 'off';
    Object.assign(input, { min: s.min, max: s.max, step: s.step });
    const value = el('span', 'value');
    input.oninput = () => {
      state.sliders[s.key] = Number(input.value);
      if (s.key === 'time') state.lightOverride = null;
      value.textContent = s.format(state.sliders[s.key]);
    };
    syncers.push(() => {
      input.value = String(state.sliders[s.key]);
      value.textContent = s.format(state.sliders[s.key]);
    });
    const wrap = labelled(s.label, input);
    wrap.append(value);
    (s.key === 'time' || s.key === 'intensity' ? rowPresets : rowSliders).append(wrap);
  }

  const setTime = (hour: number) => {
    state.sliders.time = hour;
    state.lightOverride = null;
  };
  const toggle = (key: ToggleKey) => (state.toggles[key] = !state.toggles[key]);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    const presetIndex = HOTKEYS.presets.indexOf(k);
    if (presetIndex >= 0) state.preset = PRESET_ORDER[presetIndex];
    else if (k === HOTKEYS.day) setTime(DAY_HOTKEY_HOUR);
    else if (k === HOTKEYS.night) setTime(NIGHT_HOTKEY_HOUR);
    else if (k === HOTKEYS.pause) toggle('animate');
    else if (k === HOTKEYS.debug) toggle('debug');
    else return;
    refresh();
  });

  refresh();
  return { refresh };
}

function labelled(text: string, control: HTMLElement) {
  const wrap = el('label', 'control');
  wrap.append(el('span', 'label', text), control);
  return wrap;
}

