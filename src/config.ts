/**
 * Every tunable of the prototype lives here. Geometry/palette of the room itself
 * lives in `scene/roomData.ts`; this file is about the camera, the renderer and
 * the "atmosphere" (time of day, presets, effect defaults, UI definitions).
 */
import type { Vec3 } from './math';

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
  label: string;
  /** false = bypass lighting entirely and show the flat painting. */
  lit: boolean;
  grade: Grade;
}

export const PRESETS: Record<PresetKey, Preset> = {
  original: {
    label: '原始',
    lit: false,
    grade: { exposure: 0, contrast: 1, saturation: 1, lift: [0, 0, 0], gain: [1, 1, 1], temperature: 0, vignette: 0, bloom: 0, bloomThreshold: 1, softFocus: 0 },
  },
  soft: {
    label: '柔光調色',
    lit: true,
    grade: { exposure: 0.35, contrast: 0.92, saturation: 0.95, lift: [0.05, 0.035, 0.03], gain: [1.02, 1.0, 0.97], temperature: 0.03, vignette: 0.25, bloom: 0.55, bloomThreshold: 0.75, softFocus: 0.22 },
  },
  cinema: {
    label: '電影氣氛',
    lit: true,
    grade: { exposure: 0.25, contrast: 1.18, saturation: 1.1, lift: [0.0, 0.012, 0.03], gain: [1.05, 0.99, 0.93], temperature: 0.02, vignette: 0.55, bloom: 0.9, bloomThreshold: 0.7, softFocus: 0.06 },
  },
};

export const PRESET_ORDER: PresetKey[] = ['original', 'soft', 'cinema'];

/* --------------------------------------------------------------------- UI */

export type ToggleKey = 'aiArt' | 'direct' | 'beam' | 'dust' | 'fog' | 'lamps' | 'softFocus' | 'grain' | 'chromatic' | 'animate' | 'debug';
export type SliderKey = 'time' | 'intensity' | 'beamDensity' | 'grainAmount' | 'chromaticAmount' | 'dustSpeed';
export type ViewMode = 'final' | 'albedo' | 'depth' | 'normal' | 'direct';

export const TOGGLES: { key: ToggleKey; label: string; initial: boolean }[] = [
  { key: 'aiArt', label: 'AI 原圖', initial: true },
  { key: 'direct', label: '直射光', initial: true },
  { key: 'beam', label: '光束', initial: true },
  { key: 'dust', label: '浮塵', initial: true },
  { key: 'fog', label: '流動霧', initial: true },
  { key: 'lamps', label: '室內燈', initial: true },
  { key: 'softFocus', label: '柔焦', initial: true },
  { key: 'grain', label: '膠片顆粒', initial: false },
  { key: 'chromatic', label: '色散', initial: true },
  { key: 'animate', label: '動態空氣', initial: true },
  { key: 'debug', label: '幾何資料', initial: false },
];

const formatHour = (h: number) => {
  const total = Math.round(h * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const formatFixed = (v: number) => v.toFixed(2);

export const SLIDERS: { key: SliderKey; label: string; min: number; max: number; step: number; initial: number; format: (v: number) => string }[] = [
  { key: 'time', label: '時間', min: 0, max: 24, step: 0.25, initial: DAY_HOTKEY_HOUR, format: formatHour },
  { key: 'intensity', label: '強度', min: 0, max: 1, step: 0.01, initial: 1, format: formatPercent },
  { key: 'beamDensity', label: '光束濃度', min: 0, max: 0.6, step: 0.01, initial: 0.16, format: formatFixed },
  { key: 'grainAmount', label: '顆粒', min: 0, max: 0.2, step: 0.005, initial: 0.06, format: formatFixed },
  { key: 'chromaticAmount', label: '色散', min: 0, max: 6, step: 0.1, initial: 1.5, format: formatFixed },
  { key: 'dustSpeed', label: '浮塵速度', min: 0, max: 4, step: 0.05, initial: 1, format: formatFixed },
];

export const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'final', label: '合成' },
  { key: 'albedo', label: '原圖' },
  { key: 'depth', label: '深度' },
  { key: 'normal', label: '法線' },
  { key: 'direct', label: '直射光' },
];

export const DEFAULT_PRESET: PresetKey = 'cinema';

/** Keyboard shortcuts (KeyboardEvent.key, lower-cased). */
export const HOTKEYS = {
  presets: ['1', '2', '3'],
  day: 'd',
  night: 'n',
  pause: 'p',
  debug: 'g',
  addBox: 'b',
  removeBox: ['delete', 'backspace'],
};

/** Page copy and outbound links (index.html header is filled from these). */
export const PAGE = {
  title: '房間光影',
  subtitle: '一張平光像素畫，加上 2.5D 幾何資料，就能即時打光。',
  referenceLabel: '參考：@vux429 的 Threads 貼文',
  referenceUrl: 'https://www.threads.com/@vux429/post/De7EVP5GFse',
  repoLabel: 'GitHub 原始碼',
  repoUrl: 'https://github.com/Farl/room-atmosphere-2d',
  shortcuts: [
    ['1–3', '預設'],
    ['D', '日間'],
    ['N', '夜間'],
    ['P', '暫停動態'],
    ['G', '幾何資料'],
    ['B', '新增方塊'],
    ['Delete', '刪除'],
  ] as [string, string][],
};

/** A control in the side panel: a toggle, a slider, or one of the composite widgets. */
export type PanelItem = ToggleKey | SliderKey | 'presets' | 'view' | 'edit';

/** Side panel grouped by what the controls change. */
export const PANEL_SECTIONS: { title: string; help?: string; items: PanelItem[] }[] = [
  { title: '畫面', items: ['presets', 'view', 'intensity', 'aiArt'] },
  { title: '光線', items: ['direct', 'beam', 'lamps'] },
  { title: '空氣', items: ['dust', 'fog', 'animate'] },
  { title: '鏡頭', items: ['softFocus', 'grain', 'chromatic'] },
  { title: '幾何資料', help: '拖曳黃色落點改變光的方向；點選家具拖曳移動，滾輪調整高度。', items: ['debug', 'edit'] },
];

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
export const OVERLAY = { handleRadius: 9, label: '直射光落點', lineColor: 'rgba(255,255,255,0.55)', accent: '#ffd25e' };

/* -------------------------------------------------------------------- art */

/**
 * AI-repainted base painting (scripts/ai-repaint.mjs). It replaces the flat albedo of the
 * room; the proxy geometry still drives depth, normals and shadows underneath it.
 */
export const ART = { aiAlbedo: new URL('../art/ai-albedo.png', import.meta.url).href };

/* ----------------------------------------------------------------- editor */

/** Interactive proxy editing (幾何資料 mode): drag to move, wheel to lift, add/remove boxes. */
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
