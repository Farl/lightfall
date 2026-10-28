/**
 * Floating dust motes simulated in world space, splatted into a scene-res canvas:
 *   R = mote lit by the sun/moon (inside the beam), G = mote in ambient light only.
 * The lighting shader turns R into sun-colored sparkle and G into a faint ambient speck.
 */
import { ATMOSPHERE, CAMERA, SCENE_RES } from './config';
import { project, viewDepth } from './camera';
import { lightVisible } from './lighting';
import type { Vec3 } from './math';
import type { Bounds, RoomData } from './scene/roomData';
import type { SceneLayers } from './scene/layers';

/** Motes stay off the walls by this margin and keep away from the camera plane. */
const MARGIN = 0.15;
/** Depth-code slack before a mote counts as hidden behind the painted surface. */
const OCCLUSION_SLACK = 0.004;
/** World-space mote size; at most this many scene pixels across. */
const MOTE_SIZE = 0.018;
const MAX_MOTE_PX = 2;
const TWINKLE_SPEED = 3;

interface Mote {
  p: Vec3;
  phase: number;
}

const randomIn = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export class DustField {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private motes: Mote[] = [];
  private bounds = { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };

  constructor() {
    this.canvas.width = SCENE_RES.width;
    this.canvas.height = SCENE_RES.height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Scatter `count` motes through a scene's volume (call on scene switch). */
  reset(b: Bounds, count = ATMOSPHERE.dustCount) {
    this.bounds = {
      min: [-b.width / 2 + MARGIN, MARGIN, MARGIN],
      max: [b.width / 2 - MARGIN, b.height - MARGIN, b.depth - MARGIN],
    };
    const { min, max } = this.bounds;
    this.motes = Array.from({ length: count }, () => ({ p: [0, 1, 2].map((a) => randomIn(min[a], max[a])) as Vec3, phase: Math.random() * Math.PI * 2 }));
  }

  /** Slow curl-ish drift: each axis follows a sine of the other two, then wraps inside the room. */
  update(dt: number, speed: number, time: number) {
    const s = dt * speed * ATMOSPHERE.dustDrift;
    const bounds = this.bounds;
    for (const m of this.motes) {
      const [x, y, z] = m.p;
      m.p[0] += Math.sin(y * 1.7 + time * 0.3 + m.phase) * s;
      m.p[1] += (Math.sin(z * 1.3 + time * 0.2 + m.phase) * 0.6 - 0.15) * s;
      m.p[2] += Math.cos(x * 1.1 + time * 0.25 + m.phase) * s;
      for (let a = 0; a < 3; a++) {
        const span = bounds.max[a] - bounds.min[a];
        if (m.p[a] < bounds.min[a]) m.p[a] += span;
        if (m.p[a] > bounds.max[a]) m.p[a] -= span;
      }
    }
  }

  draw(layers: SceneLayers, room: RoomData, toLight: Vec3, time: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCENE_RES.width, SCENE_RES.height);
    ctx.globalCompositeOperation = 'lighter';

    for (const m of this.motes) {
      const [sx, sy] = project(m.p);
      if (sx < 0 || sy < 0 || sx >= SCENE_RES.width || sy >= SCENE_RES.height) continue;
      if (layers.depthCode(m.p) < layers.depthAt(sx, sy) - OCCLUSION_SLACK) continue;
      const twinkle = 0.55 + 0.45 * Math.sin(time * TWINKLE_SPEED + m.phase * 7);
      const v = Math.round(255 * twinkle);
      ctx.fillStyle = lightVisible(m.p, toLight, room, layers.maskAt, time) > 0 ? `rgb(${v},0,0)` : `rgb(0,${v},0)`;
      const size = Math.min(MAX_MOTE_PX, Math.max(1, (CAMERA.focal * MOTE_SIZE) / viewDepth(m.p)));
      ctx.fillRect(Math.floor(sx), Math.floor(sy), size, size);
    }
  }
}
