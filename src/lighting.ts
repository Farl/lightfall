/**
 * Time-of-day lighting state and the CPU mirror of the shader's sun-visibility test
 * (used for dust particles and the debug overlay; keep in sync with lighting.frag).
 */
import { BOUNCE_GAIN, CELESTIAL, LAMP_LIGHT, TIME_KEYS, ATMOSPHERE, type TimeKey } from './config';
import { add, clamp, deg, lerp, lerp3, normalize, scale, type Vec3 } from './math';
import { windowCenter, type RoomData } from './scene/roomData';

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

/** Sun by day, moon by night; both arc across the window from back-left to front-left. */
export function celestialDirection(hour: number): Vec3 {
  const h = ((hour % 24) + 24) % 24;
  const { rise, set } = CELESTIAL;
  const isDay = h >= rise && h < set;
  const body = isDay ? CELESTIAL.sun : CELESTIAL.moon;
  const span = isDay ? set - rise : 24 - (set - rise);
  const s = isDay ? (h - rise) / span : ((h - set + 24) % 24) / span;
  const elevation = deg(lerp(body.minElevation, body.maxElevation, Math.sin(Math.PI * s)));
  const azimuth = deg(lerp(body.azimuthStart, body.azimuthEnd, s));
  return normalize([-Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.sin(azimuth)]);
}

export function lightingAt(hour: number, override: Vec3 | null): LightingState {
  const k = sampleKeys(hour);
  const toLight = override ?? celestialDirection(hour);
  const lightColor = scale(k.sunColor, k.sunIntensity);
  return {
    toLight,
    lightColor,
    ambientSky: k.ambientSky,
    ambientGround: k.ambientGround,
    bounce: scale(lightColor, BOUNCE_GAIN * clamp(toLight[1], 0, 1)),
    fogColor: add(scale(k.ambientSky, ATMOSPHERE.fogAmbientScale), scale(LAMP_LIGHT.color, k.lamps * BOUNCE_GAIN)),
    skyTop: k.skyTop,
    skyBottom: k.skyBottom,
    lamps: k.lamps,
    tv: k.tv,
  };
}

/** Does a ray from `o` toward the light leave through a window pane without hitting a box? */
export function lightVisible(o: Vec3, toLight: Vec3, room: RoomData): boolean {
  if (toLight[0] > -1e-4) return false;
  const t = (room.windowX - o[0]) / toLight[0];
  if (t <= 0) return false;
  const q = add(o, scale(toLight, t));
  if (!room.panes.some((p) => q[2] >= p.zMin && q[2] <= p.zMax && q[1] >= p.yMin && q[1] <= p.yMax)) return false;
  return !room.boxes.some((b) => rayHitsBox(o, toLight, t, b.min, b.max));
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

/** Where the ray through the window center lands on the floor (the draggable 直射光落點). */
export function landingPoint(room: RoomData, toLight: Vec3): Vec3 | null {
  if (toLight[1] <= 1e-4) return null;
  const c = windowCenter(room);
  return add(c, scale(toLight, -c[1] / toLight[1]));
}

/** Inverse of `landingPoint`: light direction that makes the window-center ray land at `p`. */
export function directionToLanding(room: RoomData, p: Vec3): Vec3 {
  const c = windowCenter(room);
  return normalize([c[0] - p[0], c[1] - p[1], c[2] - p[2]]);
}
