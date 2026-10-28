/**
 * Every tunable of the prototype lives here. Geometry/palette of the room itself
 * lives in `scene/roomData.ts`; this file is about the camera, the renderer and
 * the "atmosphere" (time of day, presets, effect defaults, UI definitions).
 */
import type { Vec3 } from './math';

/* ------------------------------------------------------------------ locale */

/** UI languages. Every user-facing string in this file is a `Text` with one entry per locale. */
export const LOCALES = ['zh-TW', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type Text = Record<Locale, string>;

export const I18N = {
  /** Used when neither ?lang= nor a saved choice exists and the browser language is not Chinese. */
  fallback: 'en' as Locale,
  /** Browser languages starting with this prefix default to zh-TW. */
  zhPrefix: 'zh',
  queryParam: 'lang',
  storageKey: 'room-atmosphere-2d:lang',
  /** Label of each locale on the language switch, written in that language. */
  names: { 'zh-TW': '中文', en: 'English' } as Text,
};

/* ------------------------------------------------------------------ raster */

/** Painted layers (albedo / depth / normal / dust) and the lighting pass run at this pixel-art size. */
export const SCENE_RES = { width: 640, height: 360 };

/** Display canvas = scene res * this. Post FX (bloom, grain, chromatic aberration) run at this size. */
export const OUTPUT_SCALE = 2;

/* ------------------------------------------------------------------ camera */

/**
 * One-point perspective pinhole looking down +z into the room.
 * World: x right, y up, z depth (the room spans ROOM.near..ROOM.depth in z).
 *   screenX = centerX + focal * (x - x0) / (z + dist)
 *   screenY = centerY - focal * (y - y0) / (z + dist)
 */
export const CAMERA = {
  x: 0,
  y: 2.3,
  dist: 4.0,
  focal: 360,
  /** Horizon height as a fraction of SCENE_RES.height. */
  horizon: 0.42,
};

/* --------------------------------------------------------------- renderer */

export const RENDER = {
  /** Compile-time array sizes in the lighting shader. Room data must fit. */
  maxPanes: 4,
  maxBoxes: 32,
  maxLamps: 4,
  maxShadowSamples: 8,
  maxBeamSteps: 48,

  shadowSamples: 6,
  beamSteps: 40,
  /** Offset along the surface normal before shadow rays, hides 8-bit depth quantisation acne. */
  normalBias: 0.07,
  /** Sun disc radius as a direction jitter; drives penumbra width. */
  sunSoftness: 0.035,
  /** Blur chain resolution relative to the scene. */
  blurDownscale: 2,
};

/* ---------------------------------------------------------- time of day */

export const DAY_HOTKEY_HOUR = 9;
export const NIGHT_HOTKEY_HOUR = 1.5;

/** Sun is the light source between rise and set, the moon the rest of the day. */
export const CELESTIAL = {
  rise: 6,
  set: 18,
  /** Degrees. Azimuth 0 = light travels straight along +x (perpendicular to the window wall). */
  sun: { minElevation: 10, maxElevation: 52, azimuthStart: 28, azimuthEnd: -28 },
  moon: { minElevation: 14, maxElevation: 40, azimuthStart: 20, azimuthEnd: -20 },
};

/** Lighting look at a given hour; sampled cyclically with linear interpolation. Colors are linear RGB. */
export interface TimeKey {
  hour: number;
  sunColor: Vec3;
  sunIntensity: number;
  ambientSky: Vec3;
  ambientGround: Vec3;
  skyTop: Vec3;
  skyBottom: Vec3;
  /** 0..1 indoor lamps (also their emissive discs). */
  lamps: number;
  /** 0..1 TV glow. */
  tv: number;
}

export const TIME_KEYS: TimeKey[] = [
  { hour: 0.0, sunColor: [0.42, 0.55, 1.0], sunIntensity: 0.9, ambientSky: [0.05, 0.07, 0.16], ambientGround: [0.03, 0.035, 0.08], skyTop: [0.04, 0.06, 0.18], skyBottom: [0.12, 0.17, 0.38], lamps: 0, tv: 1 },
  { hour: 5.6, sunColor: [0.42, 0.55, 1.0], sunIntensity: 0.4, ambientSky: [0.09, 0.1, 0.2], ambientGround: [0.05, 0.05, 0.1], skyTop: [0.15, 0.2, 0.42], skyBottom: [0.5, 0.42, 0.55], lamps: 0, tv: 0 },
  { hour: 6.0, sunColor: [1.0, 0.55, 0.32], sunIntensity: 0.0, ambientSky: [0.2, 0.19, 0.24], ambientGround: [0.12, 0.1, 0.12], skyTop: [0.3, 0.38, 0.65], skyBottom: [1.0, 0.66, 0.46], lamps: 0, tv: 0 },
  { hour: 7.0, sunColor: [1.0, 0.62, 0.38], sunIntensity: 2.0, ambientSky: [0.32, 0.29, 0.31], ambientGround: [0.2, 0.16, 0.15], skyTop: [0.38, 0.55, 0.85], skyBottom: [1.0, 0.78, 0.58], lamps: 0, tv: 0 },
  { hour: 9.0, sunColor: [1.0, 0.84, 0.64], sunIntensity: 2.6, ambientSky: [0.32, 0.32, 0.36], ambientGround: [0.2, 0.17, 0.15], skyTop: [0.36, 0.62, 0.95], skyBottom: [0.8, 0.9, 1.0], lamps: 0, tv: 0 },
  { hour: 13.0, sunColor: [1.0, 0.95, 0.88], sunIntensity: 2.8, ambientSky: [0.36, 0.37, 0.41], ambientGround: [0.23, 0.2, 0.18], skyTop: [0.3, 0.58, 0.98], skyBottom: [0.75, 0.88, 1.0], lamps: 0, tv: 0 },
  { hour: 16.5, sunColor: [1.0, 0.68, 0.4], sunIntensity: 2.6, ambientSky: [0.31, 0.27, 0.27], ambientGround: [0.2, 0.15, 0.13], skyTop: [0.4, 0.5, 0.82], skyBottom: [1.0, 0.72, 0.48], lamps: 0, tv: 0 },
  { hour: 17.8, sunColor: [1.0, 0.42, 0.3], sunIntensity: 1.6, ambientSky: [0.26, 0.2, 0.24], ambientGround: [0.16, 0.11, 0.12], skyTop: [0.3, 0.3, 0.6], skyBottom: [1.0, 0.5, 0.36], lamps: 0.4, tv: 0 },
  { hour: 18.0, sunColor: [1.0, 0.42, 0.3], sunIntensity: 0.0, ambientSky: [0.18, 0.15, 0.22], ambientGround: [0.1, 0.08, 0.11], skyTop: [0.18, 0.2, 0.45], skyBottom: [0.7, 0.38, 0.4], lamps: 0.8, tv: 0 },
  { hour: 19.5, sunColor: [0.42, 0.55, 1.0], sunIntensity: 0.5, ambientSky: [0.07, 0.08, 0.16], ambientGround: [0.04, 0.04, 0.09], skyTop: [0.05, 0.07, 0.2], skyBottom: [0.15, 0.18, 0.4], lamps: 1, tv: 1 },
  { hour: 23.5, sunColor: [0.42, 0.55, 1.0], sunIntensity: 0.8, ambientSky: [0.05, 0.07, 0.16], ambientGround: [0.03, 0.035, 0.08], skyTop: [0.04, 0.06, 0.18], skyBottom: [0.12, 0.17, 0.38], lamps: 1, tv: 1 },
];

/** Indoor lamp light: color * TimeKey.lamps * intensity / (1 + falloff * d^2). */
export const LAMP_LIGHT = { color: [1.0, 0.76, 0.5] as Vec3, intensity: 2.4, falloff: 0.22, emissive: 3.0 };
export const TV_LIGHT = { color: [0.55, 0.75, 1.0] as Vec3, emissive: 2.2, flickerSpeed: 23 };
/** Sky seen through the glass is multiplied by this (HDR, so it blooms). */
export const SKY_GAIN = 1.5;
/** Cheap one-bounce fill: ambient += sunColor * this * elevationFactor. */
export const BOUNCE_GAIN = 0.07;

/* ------------------------------------------------------------- atmosphere */

export const ATMOSPHERE = {
  fogDensity: 0.22,
  fogHeightFalloff: 0.7,
  fogDrift: 0.12,
  /** Fog color = ambientSky * this. */
  fogAmbientScale: 1.0,
  /** Window "dirt" noise that breaks the beam into streaky shafts. */
  shaftScale: 5.5,
  shaftAmount: 0.75,
  dustCount: 420,
  /** Dust inside the beam scatters sun light, outside it is barely visible. */
  dustLitGain: 2.4,
  dustAmbientGain: 0.5,
  dustDrift: 0.08,
};

/* ------------------------------------------------------------------ grading */

export interface Grade {
  exposure: number;
  contrast: number;
  saturation: number;
  /** Additive lift of shadows, display space. */
  lift: Vec3;
  /** Multiplicative gain, display space. */
  gain: Vec3;
  /** >0 warms (more red, less blue). */
  temperature: number;
  vignette: number;
  bloom: number;
  bloomThreshold: number;
  /** "Orton" soft focus: mix of the blurred image into the sharp one. */
  softFocus: number;
}

export type PresetKey = 'original' | 'soft' | 'cinema';

export interface Preset {
  label: Text;
  /** false = bypass lighting entirely and show the flat painting. */
  lit: boolean;
  grade: Grade;
}

export const PRESETS: Record<PresetKey, Preset> = {
  original: {
    label: { 'zh-TW': '原始', en: 'Original' },
    lit: false,
    grade: { exposure: 0, contrast: 1, saturation: 1, lift: [0, 0, 0], gain: [1, 1, 1], temperature: 0, vignette: 0, bloom: 0, bloomThreshold: 1, softFocus: 0 },
  },
  soft: {
    label: { 'zh-TW': '柔光調色', en: 'Soft' },
    lit: true,
    grade: { exposure: 0.35, contrast: 0.92, saturation: 0.95, lift: [0.05, 0.035, 0.03], gain: [1.02, 1.0, 0.97], temperature: 0.03, vignette: 0.25, bloom: 0.55, bloomThreshold: 0.75, softFocus: 0.22 },
  },
  cinema: {
    label: { 'zh-TW': '電影氣氛', en: 'Cinematic' },
    lit: true,
    grade: { exposure: 0.25, contrast: 1.18, saturation: 1.1, lift: [0.0, 0.012, 0.03], gain: [1.05, 0.99, 0.93], temperature: 0.02, vignette: 0.55, bloom: 0.9, bloomThreshold: 0.7, softFocus: 0.06 },
  },
};

export const PRESET_ORDER: PresetKey[] = ['original', 'soft', 'cinema'];

/* --------------------------------------------------------------------- UI */

/**
 * `edit` and `geometry` are independent: edit = pointer interaction (landing-point handle,
 * select/drag/lift furniture), geometry = draw the proxy wireframes, panes and rays.
 */
export type ToggleKey = 'aiArt' | 'direct' | 'beam' | 'dust' | 'fog' | 'lamps' | 'softFocus' | 'grain' | 'chromatic' | 'animate' | 'edit' | 'geometry';
export type SliderKey = 'time' | 'intensity' | 'beamDensity' | 'grainAmount' | 'chromaticAmount' | 'dustSpeed';
export type ViewMode = 'final' | 'albedo' | 'depth' | 'normal' | 'direct';

export const TOGGLES: { key: ToggleKey; label: Text; initial: boolean }[] = [
  { key: 'aiArt', label: { 'zh-TW': 'AI 原圖', en: 'AI art' }, initial: true },
  { key: 'direct', label: { 'zh-TW': '直射光', en: 'Sunlight' }, initial: true },
  { key: 'beam', label: { 'zh-TW': '光束', en: 'Beams' }, initial: true },
  { key: 'dust', label: { 'zh-TW': '浮塵', en: 'Dust' }, initial: true },
  { key: 'fog', label: { 'zh-TW': '流動霧', en: 'Fog' }, initial: true },
  { key: 'lamps', label: { 'zh-TW': '室內燈', en: 'Lamps' }, initial: true },
  { key: 'softFocus', label: { 'zh-TW': '柔焦', en: 'Soft focus' }, initial: true },
  { key: 'grain', label: { 'zh-TW': '膠片顆粒', en: 'Grain' }, initial: false },
  { key: 'chromatic', label: { 'zh-TW': '色散', en: 'Chromatic' }, initial: true },
  { key: 'animate', label: { 'zh-TW': '動態空氣', en: 'Animate' }, initial: true },
  { key: 'edit', label: { 'zh-TW': '編輯', en: 'Edit' }, initial: false },
  { key: 'geometry', label: { 'zh-TW': '顯示幾何', en: 'Show geometry' }, initial: false },
];

const formatHour = (h: number) => {
  const total = Math.round(h * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const formatFixed = (v: number) => v.toFixed(2);

export const SLIDERS: { key: SliderKey; label: Text; min: number; max: number; step: number; initial: number; format: (v: number) => string }[] = [
  { key: 'time', label: { 'zh-TW': '時間', en: 'Time' }, min: 0, max: 24, step: 0.25, initial: DAY_HOTKEY_HOUR, format: formatHour },
  { key: 'intensity', label: { 'zh-TW': '強度', en: 'Intensity' }, min: 0, max: 1, step: 0.01, initial: 1, format: formatPercent },
  { key: 'beamDensity', label: { 'zh-TW': '光束濃度', en: 'Beam density' }, min: 0, max: 0.6, step: 0.01, initial: 0.16, format: formatFixed },
  { key: 'grainAmount', label: { 'zh-TW': '顆粒', en: 'Grain' }, min: 0, max: 0.2, step: 0.005, initial: 0.06, format: formatFixed },
  { key: 'chromaticAmount', label: { 'zh-TW': '色散', en: 'Chromatic' }, min: 0, max: 6, step: 0.1, initial: 1.5, format: formatFixed },
  { key: 'dustSpeed', label: { 'zh-TW': '浮塵速度', en: 'Dust speed' }, min: 0, max: 4, step: 0.05, initial: 1, format: formatFixed },
];

export const VIEW_MODES: { key: ViewMode; label: Text }[] = [
  { key: 'final', label: { 'zh-TW': '合成', en: 'Final' } },
  { key: 'albedo', label: { 'zh-TW': '原圖', en: 'Albedo' } },
  { key: 'depth', label: { 'zh-TW': '深度', en: 'Depth' } },
  { key: 'normal', label: { 'zh-TW': '法線', en: 'Normal' } },
  { key: 'direct', label: { 'zh-TW': '直射光', en: 'Sun' } },
];

export const DEFAULT_PRESET: PresetKey = 'cinema';

/** Keyboard shortcuts (KeyboardEvent.key, lower-cased). */
export const HOTKEYS = {
  presets: ['1', '2', '3'],
  day: 'd',
  night: 'n',
  pause: 'p',
  edit: 'e',
  geometry: 'g',
  addBox: 'b',
  removeBox: ['delete', 'backspace'],
};

/** Page copy and outbound links (index.html header is filled from these). */
export const PAGE = {
  documentTitle: { 'zh-TW': '房間光影 · Room Atmosphere 2D', en: 'Room Atmosphere 2D' } as Text,
  title: { 'zh-TW': '房間光影', en: 'Room Atmosphere' } as Text,
  subtitle: {
    'zh-TW': '一張平光像素畫，加上 2.5D 幾何資料，就能即時打光。',
    en: 'A flat-lit pixel painting, relit live from a little 2.5D geometry.',
  } as Text,
  referenceLabel: { 'zh-TW': '參考：@vux429 的 Threads 貼文', en: 'Reference: @vux429 on Threads' } as Text,
  referenceUrl: 'https://www.threads.com/@vux429/post/De7EVP5GFse',
  repoLabel: { 'zh-TW': 'GitHub 原始碼', en: 'Source on GitHub' } as Text,
  repoUrl: 'https://github.com/Farl/room-atmosphere-2d',
  shortcuts: [
    ['1–3', { 'zh-TW': '預設', en: 'Presets' }],
    ['D', { 'zh-TW': '日間', en: 'Day' }],
    ['N', { 'zh-TW': '夜間', en: 'Night' }],
    ['P', { 'zh-TW': '暫停動態', en: 'Pause' }],
    ['E', { 'zh-TW': '編輯', en: 'Edit' }],
    ['G', { 'zh-TW': '顯示幾何', en: 'Geometry' }],
    ['B', { 'zh-TW': '新增方塊', en: 'Add box' }],
    ['Delete', { 'zh-TW': '刪除', en: 'Delete' }],
  ] as [string, Text][],
};

/** Copy for the generated controls that is not a toggle/slider/preset label. */
export const UI_TEXT = {
  panel: { 'zh-TW': '控制面板', en: 'Controls' },
  language: { 'zh-TW': '語言', en: 'Language' },
  time: { 'zh-TW': '時間', en: 'Time' },
  day: { 'zh-TW': '日間', en: 'Day' },
  night: { 'zh-TW': '夜間', en: 'Night' },
  presets: { 'zh-TW': '預設', en: 'Preset' },
  view: { 'zh-TW': '檢視', en: 'View' },
  toolbar: { 'zh-TW': '場景與幾何資料', en: 'Scene and geometry' },
  scene: { 'zh-TW': '場景', en: 'Scene' },
  addBox: { 'zh-TW': '新增方塊', en: 'Add box' },
  removeSelected: { 'zh-TW': '刪除選取', en: 'Delete selected' },
  resetScene: { 'zh-TW': '重設場景', en: 'Reset scene' },
  editHint: {
    'zh-TW': '拖曳黃色落點改變光的方向；點選家具拖曳移動，滾輪調整高度。',
    en: 'Drag the yellow point to aim the light. Click furniture to drag it; scroll to lift.',
  },
} satisfies Record<string, Text>;

/** A control in the side panel: a toggle, a slider, or one of the composite widgets. */
export type PanelItem = ToggleKey | SliderKey | 'presets' | 'view';

/**
 * Side panel grouped by what the controls change. The geometry toggles are not here:
 * they live in the toolbar under the stage (STAGE_TOOLBAR) so they never scroll away.
 */
export const PANEL_SECTIONS: { title: Text; items: PanelItem[] }[] = [
  { title: { 'zh-TW': '畫面', en: 'Image' }, items: ['presets', 'view', 'intensity', 'aiArt'] },
  { title: { 'zh-TW': '光線', en: 'Light' }, items: ['direct', 'beam', 'lamps'] },
  { title: { 'zh-TW': '空氣', en: 'Air' }, items: ['dust', 'fog', 'animate'] },
  { title: { 'zh-TW': '鏡頭', en: 'Lens' }, items: ['softFocus', 'grain', 'chromatic'] },
];

/** Toggles in the toolbar directly under the stage. */
export const STAGE_TOOLBAR: ToggleKey[] = ['edit', 'geometry'];

/** Amount sliders shown on the same row as their effect toggle (dimmed while it is off). */
export const TOGGLE_AMOUNTS: Partial<Record<ToggleKey, SliderKey>> = {
  beam: 'beamDensity',
  dust: 'dustSpeed',
  grain: 'grainAmount',
  chromatic: 'chromaticAmount',
};

/** 24h sky band under the stage: gradient sampled from TIME_KEYS every `sampleStep` hours. */
export const TIME_BAND = { sampleStep: 0.5, tickEvery: 3 };

/** Debug overlay: landing-point handle size in display pixels. */
export const OVERLAY = { handleRadius: 9, label: { 'zh-TW': '直射光落點', en: 'Light landing point' } as Text, lineColor: 'rgba(255,255,255,0.55)', accent: '#ffd25e' };

/* -------------------------------------------------------------------- art */

/**
 * AI-repainted base painting (scripts/ai-repaint.mjs). It replaces the flat albedo of the
 * room; the proxy geometry still drives depth, normals and shadows underneath it.
 */
export const ART = { aiAlbedo: new URL('../art/ai-albedo.png', import.meta.url).href };

/* ----------------------------------------------------------------- editor */

/** Interactive proxy editing (編輯 mode): drag to move, wheel to lift, add/remove boxes. */
export const EDITOR = {
  /** Size of a box added with the 新增方塊 button, in world units. */
  newBoxSize: [0.6, 0.9, 0.6] as Vec3,
  /** Where new boxes appear (x, z on the floor): the edge of the morning patch, clear of the landing handle. */
  newBoxSpawn: [-1.3, 3.3] as [number, number],
  newBoxColors: ['#7f9cc4', '#d6a35c', '#9c7bb5', '#6fae8f'],
  /** World units per wheel notch when lifting a group. */
  liftStep: 0.05,
  /** Keep groups this far from the walls. */
  wallMargin: 0.02,
  selectedColor: '#5ec8ff',
};
