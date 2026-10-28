/**
 * Switchable scenes. Each pairs its proxy data with the look that suits it: the sun's
 * arc (a wall window wants sun from the side, a backlit forest low sun behind), how dark the ambient is, and
 * atmosphere overrides. Everything not overridden comes from config.ts.
 */
import { ART, ATMOSPHERE, CELESTIAL, EDITOR, type Text } from '../config';
import { CLOISTER_DATA } from './cloisterData';
import { FOREST_DATA } from './forestData';
import { ROOM_DATA, type RoomData } from './roomData';

export type SceneKey = 'room' | 'forest' | 'cloister';
export type Celestial = typeof CELESTIAL;
export type Atmosphere = typeof ATMOSPHERE;

export interface SceneDef {
  label: Text;
  data: RoomData;
  /** Optional repainted base art (must share the proxy layout); toggled by AI 原圖. */
  art?: string;
  celestial: Celestial;
  /** Multiplies the time-of-day ambient; darker shade makes beams read better. */
  ambientScale: number;
  /** Multiplies the 光束濃度 slider: open scenes have far longer light paths than a window cone. */
  beamScale: number;
  atmosphere: Partial<Atmosphere>;
  /** Sun disc radius as a direction jitter (penumbra width); fine tracery needs a smaller one than RENDER's. */
  sunSoftness?: number;
  /** The sun itself where sky is visible: disc gain, disc sharpness (cosine power), halo gain. 0 = not drawn. */
  sun: { disc: number; sharpness: number; halo: number };
  /** (x, z) where 新增方塊 drops a new box. */
  boxSpawn: [number, number];
}

const NO_SUN: SceneDef['sun'] = { disc: 0, sharpness: 1, halo: 0 };

export const SCENES: Record<SceneKey, SceneDef> = {
  room: {
    label: { 'zh-TW': '房間', en: 'Room' },
    data: ROOM_DATA,
    art: ART.aiAlbedo,
    celestial: CELESTIAL,
    ambientScale: 1,
    beamScale: 1,
    atmosphere: {},
    sun: NO_SUN,
    boxSpawn: EDITOR.newBoxSpawn,
  },
  forest: {
    label: { 'zh-TW': '樹林', en: 'Forest' },
    data: FOREST_DATA,
    art: ART.forestAiAlbedo,
    // Low sun behind the trees, travelling from back-left to back-right (azimuth -90 = straight at the camera).
    celestial: {
      ...CELESTIAL,
      sun: { minElevation: 6, maxElevation: 20, azimuthStart: -68, azimuthEnd: -112 },
      moon: { minElevation: 10, maxElevation: 24, azimuthStart: -75, azimuthEnd: -105 },
    },
    ambientScale: 0.55,
    beamScale: 0.11,
    // Strong forward scattering is what makes backlit shafts glow; the silhouettes already break them up.
    atmosphere: { shaftAmount: 0.1, fogDensity: 0.12, fogHeightFalloff: 0.25, phaseG: 0.6, dustCount: 900 },
    sun: { disc: 6, sharpness: 900, halo: 0.5 },
    boxSpawn: [-0.4, 2.6],
  },
  cloister: {
    label: { 'zh-TW': '迴廊', en: 'Cloister' },
    data: CLOISTER_DATA,
    // Sun over the courtyard on the left, high enough to throw the tracery onto the floor.
    celestial: { ...CELESTIAL, sun: { ...CELESTIAL.sun, minElevation: 22, maxElevation: 52 } },
    ambientScale: 0.75,
    beamScale: 0.8,
    // The tracery is the pattern; the "dirty glass" streaks would blur it.
    atmosphere: { shaftAmount: 0.05, fogDensity: 0.16, phaseG: 0.45 },
    sunSoftness: 0.008,
    sun: NO_SUN,
    boxSpawn: [0.6, 5.0],
  },
};

export const SCENE_ORDER: SceneKey[] = ['room', 'forest', 'cloister'];
export const DEFAULT_SCENE: SceneKey = 'room';

export const atmosphereOf = (scene: SceneDef): Atmosphere => ({ ...ATMOSPHERE, ...scene.atmosphere });
