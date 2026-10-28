/**
 * Switchable scenes. Each pairs its proxy data with the look that suits it: the sun's
 * arc (a wall window wants low sun, a canopy higher), how dark the ambient is, and
 * atmosphere overrides. Everything not overridden comes from config.ts.
 */
import { ART, ATMOSPHERE, CELESTIAL, EDITOR, type Text } from '../config';
import { FOREST_DATA } from './forestData';
import { ROOM_DATA, type RoomData } from './roomData';

export type SceneKey = 'room' | 'forest';
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
  /** (x, z) where 新增方塊 drops a new box. */
  boxSpawn: [number, number];
}

export const SCENES: Record<SceneKey, SceneDef> = {
  room: {
    label: { 'zh-TW': '房間', en: 'Room' },
    data: ROOM_DATA,
    art: ART.aiAlbedo,
    celestial: CELESTIAL,
    ambientScale: 1,
    beamScale: 1,
    atmosphere: {},
    boxSpawn: EDITOR.newBoxSpawn,
  },
  forest: {
    label: { 'zh-TW': '樹林', en: 'Forest' },
    data: FOREST_DATA,
    // Sun overhead-left so rays cross the canopy instead of skimming under it.
    celestial: {
      ...CELESTIAL,
      sun: { minElevation: 38, maxElevation: 66, azimuthStart: 24, azimuthEnd: -24 },
      moon: { minElevation: 40, maxElevation: 58, azimuthStart: 18, azimuthEnd: -18 },
    },
    ambientScale: 0.5,
    beamScale: 0.45,
    // The leaf gaps already break the light into shafts; the "dirty glass" streaks would double it.
    atmosphere: { shaftAmount: 0.15, fogDensity: 0.3, fogHeightFalloff: 0.35, dustCount: 700 },
    boxSpawn: [-0.4, 2.6],
  },
};

export const SCENE_ORDER: SceneKey[] = ['room', 'forest'];
export const DEFAULT_SCENE: SceneKey = 'room';

export const atmosphereOf = (scene: SceneDef): Atmosphere => ({ ...ATMOSPHERE, ...scene.atmosphere });
