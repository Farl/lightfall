/**
 * Time-of-day lighting state and the CPU mirror of the shader's sun-visibility test
 * (used for dust particles and the debug overlay; keep in sync with lighting.frag).
 */
import { BOUNCE_GAIN, LAMP_LIGHT, TIME_KEYS, ATMOSPHERE, type TimeKey } from './config';
import { add, clamp, deg, lerp, lerp3, normalize, scale, sub, type Vec3 } from './math';
import { apertureInward, lightAnchor, planeUv, type OccluderLayer, type RoomData } from './scene/roomData';
import type { Celestial, SceneDef } from './scene/scenes';

/** Solid coverage (0..1) of occluder layer `i` at its (u, v); supplied by SceneLayers from the layer textures. */
export type OccluderSampler = (i: number, u: number, v: number) => number;

/** Shadow rays start on painted layers; crossings closer than this are the layer itself. */
const SELF_CROSSING = 0.02;

export interface LightingState {
  /** Unit vector pointing toward the light source (sun or moon). */
  toLight: Vec3;
  /** Light color already multiplied by intensity. */
  lightColor: Vec3;
  ambientSky: Vec3;
  ambientGround: Vec3;
  bounce: Vec3;
  fogColor: Vec3;
  skyTop: Vec3;
  skyBottom: Vec3;
  lamps: number;
  tv: number;
}

function sampleKeys(hour: number): TimeKey {
  const keys = TIME_KEYS;
  const h = ((hour % 24) + 24) % 24;
  let i = keys.findIndex((k) => k.hour > h);
  if (i === -1) i = keys.length;
  const a = keys[(i - 1 + keys.length) % keys.length];
  const b = keys[i % keys.length];
  const span = (b.hour - a.hour + 24) % 24 || 24;
  const t = ((h - a.hour + 24) % 24) / span;
  return {
    hour: h,
    sunColor: lerp3(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    ambientSky: lerp3(a.ambientSky, b.ambientSky, t),
    ambientGround: lerp3(a.ambientGround, b.ambientGround, t),
    skyTop: lerp3(a.skyTop, b.skyTop, t),
    skyBottom: lerp3(a.skyBottom, b.skyBottom, t),
    lamps: lerp(a.lamps, b.lamps, t),
    tv: lerp(a.tv, b.tv, t),
  };
}

/** Display-space (sRGB 0..255) sky color at an hour, for UI swatches like the time band. */
export function skyColorAt(hour: number): Vec3 {
  const k = sampleKeys(hour);
  return lerp3(k.skyTop, k.skyBottom, 0.5).map((c) => Math.round(255 * Math.pow(clamp(c, 0, 1), 1 / 2.2))) as Vec3;
}

/** Sun by day, moon by night; both arc from back-left to front-left. */
export function celestialDirection(hour: number, celestial: Celestial): Vec3 {
  const h = ((hour % 24) + 24) % 24;
  const { rise, set } = celestial;
  const isDay = h >= rise && h < set;
  const body = isDay ? celestial.sun : celestial.moon;
  const span = isDay ? set - rise : 24 - (set - rise);
  const s = isDay ? (h - rise) / span : ((h - set + 24) % 24) / span;
  const elevation = deg(lerp(body.minElevation, body.maxElevation, Math.sin(Math.PI * s)));
  const azimuth = deg(lerp(body.azimuthStart, body.azimuthEnd, s));
  return normalize([-Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.sin(azimuth)]);
}

/** @param hasLamps scenes without indoor lamps (outdoors) get no lamp tint in their fog. */
export function lightingAt(hour: number, override: Vec3 | null, scene: SceneDef, hasLamps: boolean): LightingState {
  const k = sampleKeys(hour);
  const toLight = override ?? celestialDirection(hour, scene.celestial);
  const lightColor = scale(k.sunColor, k.sunIntensity);
  const lamps = hasLamps ? k.lamps : 0;
  const ambientSky = scale(k.ambientSky, scene.ambientScale);
  return {
    toLight,
    lightColor,
    ambientSky,
    ambientGround: scale(k.ambientGround, scene.ambientScale),
    bounce: scale(lightColor, BOUNCE_GAIN * clamp(toLight[1], 0, 1)),
    fogColor: add(scale(ambientSky, ATMOSPHERE.fogAmbientScale), scale(LAMP_LIGHT.color, lamps * BOUNCE_GAIN)),
    skyTop: k.skyTop,
    skyBottom: k.skyBottom,
    lamps,
    tv: k.tv,
  };
}

/** Wind sway (u offset) of a layer at height v. Mirrors windOffset() in lighting.frag. */
export function windOffset(layer: OccluderLayer, v: number, time: number): number {
  if (!layer.wind) return 0;
  const { amplitude, speed } = layer.wind;
  return amplitude * Math.sin(time * speed + v * 0.9);
}

/**
 * Light reaching `o` (0..1): the ray toward the light must cross the aperture inside a pane
 * without hitting a box, and is dimmed by every cut-out layer it crosses on the way.
 * Mirrors lightVisible() in lighting.frag, minus the distance blur (dust only needs a yes/no).
 */
export function lightVisible(o: Vec3, toLight: Vec3, room: RoomData, occluderAt: OccluderSampler | null = null, time = 0): number {
  const a = room.aperture;
  const t = (a.at - o[a.axis]) / toLight[a.axis];
  if (!(t > 0) || !Number.isFinite(t)) return 0;
  const [u, v] = planeUv(a, add(o, scale(toLight, t)));
  if (!a.panes.some(([u0, v0, u1, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1)) return 0;
  if (room.boxes.some((b) => rayHitsBox(o, toLight, t, b.min, b.max))) return 0;
  let transmit = 1;
  if (occluderAt) {
    room.occluders.forEach((layer, i) => {
      const tl = (layer.at - o[layer.axis]) / toLight[layer.axis];
      if (!(tl > SELF_CROSSING && tl < t)) return;
      const [lu, lv] = planeUv(layer, add(o, scale(toLight, tl)));
      transmit *= 1 - occluderAt(i, lu + windOffset(layer, lv, time), lv);
    });
  }
  return transmit;
}

/** Slab test. Like the shader, a box containing the origin does not count (near must be > 0). */
function rayHitsBox(o: Vec3, d: Vec3, tMax: number, min: Vec3, max: Vec3): boolean {
  let near = -Infinity;
  let far = tMax;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return false;
      continue;
    }
    let t0 = (min[i] - o[i]) / d[i];
    let t1 = (max[i] - o[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return false;
  }
  return near > 0;
}

/** Where the ray through the aperture center lands on the floor (the draggable 直射光落點). */
export function landingPoint(room: RoomData, toLight: Vec3): Vec3 | null {
  if (toLight[1] <= 1e-4) return null;
  const c = lightAnchor(room);
  return add(c, scale(toLight, -c[1] / toLight[1]));
}

/** Landing points closer to the aperture plane than this are refused (the light would graze it). */
const LANDING_MARGIN = 0.2;

/** Inverse of `landingPoint`: light direction that makes the center ray land at `p`, or null if `p` is not inside. */
export function directionToLanding(room: RoomData, p: Vec3): Vec3 | null {
  const a = room.aperture;
  if ((p[a.axis] - a.at) * apertureInward(room) <= LANDING_MARGIN) return null;
  return normalize(sub(lightAnchor(room), p));
}
