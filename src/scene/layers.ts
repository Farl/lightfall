/**
 * Rasterises the room into three aligned Canvas2D layers, all at SCENE_RES:
 *
 *   albedo  the flat "original" painting (what you would get from an artist)
 *   depth     R = normalised 1/w
 *   normal    RGB = world normal * 0.5 + 0.5
 *   emissive  R = sky, G = lamp, B = TV coverage masks
 *
 * depth + normal together are the G-buffer the lighting shader reconstructs world
 * positions from. Every primitive goes through `fillPolygon`, so the three layers
 * can never disagree about coverage or draw order (painter's algorithm, far to near).
 */
import { CAMERA, SCENE_RES } from '../config';
import { depthCode, project, viewDepth } from '../camera';
import { shadeHex, type Vec2, type Vec3 } from '../math';
import { Emissive, FACE_SHADE, PLANE_EXTENT, PLANE_NORMAL, planePoint, type BoxDef, type Plane, type RoomData } from './roomData';

/** Segments used to approximate a disc lying on a plane. */
const DISC_SEGMENTS = 24;
/** Decals sit exactly on their plane; painter order (not depth) keeps them on top. */
const SHELL_ORDER: Plane[] = ['back', 'ceiling', 'floor', 'left', 'right'];

const encodeNormal = (n: Vec3) => `rgb(${n.map((c) => Math.round((c * 0.5 + 0.5) * 255)).join(',')})`;
const depthColor = (code: number) => `rgb(${Math.round(code * 255)},0,0)`;
/** One mask channel per emissive kind, so anti-aliased edges blend coverage instead of ids. */
const EMISSIVE_COLOR: Record<Emissive, string> = {
  [Emissive.None]: '#000000',
  [Emissive.Sky]: '#ff0000',
  [Emissive.Lamp]: '#00ff00',
  [Emissive.Tv]: '#0000ff',
};

function makeCanvas(readback: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_RES.width;
  canvas.height = SCENE_RES.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: readback })!;
  return { canvas, ctx };
}

export class SceneLayers {
  readonly albedo = makeCanvas(false);
  readonly depth = makeCanvas(true);
  readonly normal = makeCanvas(false);
  readonly emissive = makeCanvas(false);
  /** CPU copy of the depth layer, used to occlude dust particles. */
  private depthPixels: Uint8ClampedArray | null = null;

  /**
   * @param painting optional base painting (e.g. the AI repaint) that replaces the flat albedo.
   *   It must share the proxy's layout; boxes flagged `overpaint` are painted on top of it.
   */
  build(room: RoomData, painting: CanvasImageSource | null = null) {
    for (const layer of [this.albedo, this.depth, this.normal, this.emissive]) layer.ctx.clearRect(0, 0, SCENE_RES.width, SCENE_RES.height);

    for (const plane of SHELL_ORDER) {
      const [u0, v0, u1, v1] = PLANE_EXTENT[plane];
      this.planeRect(plane, [u0, v0, u1, v1], room.shell[plane], Emissive.None);
      for (const d of room.decals) if (d.plane === plane) this.planeRect(plane, d.rect, d.color, d.emissive ?? Emissive.None);
      for (const d of room.discs) if (d.plane === plane) this.planeDisc(plane, d.center, d.radius, d.color, d.emissive ?? Emissive.None);
    }

    // Boxes and blobs share one far-to-near list. Blobs sort by their near edge so foliage lands over its pot.
    const drawables: { key: number; draw: () => void }[] = [
      ...room.boxes.filter((b) => !b.hidden).map((b) => ({ key: b.max[2], draw: () => this.box(b) })),
      ...room.blobs.map((b) => ({ key: b.center[2] - b.radius, draw: () => this.blob(b.center, b.radius, b.color, b.normal) })),
    ];
    drawables.sort((a, b) => b.key - a.key).forEach((d) => d.draw());

    if (painting) {
      const ctx = this.albedo.ctx;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(painting, 0, 0, SCENE_RES.width, SCENE_RES.height);
      for (const b of room.boxes) if (b.overpaint && !b.hidden) this.box(b, true);
    }

    this.depthPixels = this.depth.ctx.getImageData(0, 0, SCENE_RES.width, SCENE_RES.height).data;
  }

  /** Normalised depth code of the surface at a scene pixel (0 = far). */
  depthAt(sx: number, sy: number): number {
    if (!this.depthPixels) return 0;
    const x = Math.min(SCENE_RES.width - 1, Math.max(0, Math.floor(sx)));
    const y = Math.min(SCENE_RES.height - 1, Math.max(0, Math.floor(sy)));
    return this.depthPixels[(y * SCENE_RES.width + x) * 4] / 255;
  }

  /* -------------------------------------------------------------- primitives */

  private planeRect(plane: Plane, [u0, v0, u1, v1]: [number, number, number, number], color: string, emissive: Emissive) {
    const pts = [planePoint(plane, u0, v0), planePoint(plane, u1, v0), planePoint(plane, u1, v1), planePoint(plane, u0, v1)];
    this.fillPolygon(pts, color, PLANE_NORMAL[plane], emissive);
  }

  private planeDisc(plane: Plane, [cu, cv]: [number, number], r: number, color: string, emissive: Emissive) {
    const pts: Vec3[] = [];
    for (let i = 0; i < DISC_SEGMENTS; i++) {
      const a = (i / DISC_SEGMENTS) * Math.PI * 2;
      pts.push(planePoint(plane, cu + Math.cos(a) * r, cv + Math.sin(a) * r));
    }
    this.fillPolygon(pts, color, PLANE_NORMAL[plane], emissive);
  }

  /** Visible faces of an axis-aligned box, back faces culled against the camera. */
  /** @param albedoOnly repaint just the color layer (G-buffer already holds this box). */
  private box(b: BoxDef, albedoOnly = false) {
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    const faces: { pts: Vec3[]; n: Vec3; shade: number }[] = [];
    if (y1 < CAMERA.y) faces.push({ pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], n: [0, 1, 0], shade: FACE_SHADE.top });
    if (y0 > CAMERA.y) faces.push({ pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], n: [0, -1, 0], shade: FACE_SHADE.bottom });
    if (CAMERA.x < x0) faces.push({ pts: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], n: [-1, 0, 0], shade: FACE_SHADE.side });
    if (CAMERA.x > x1) faces.push({ pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], n: [1, 0, 0], shade: FACE_SHADE.side });
    faces.push({ pts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], n: [0, 0, -1], shade: FACE_SHADE.front });

    for (const f of faces) this.fillPolygon(f.pts, shadeHex(b.color, f.shade), f.n, Emissive.None, albedoOnly);
    for (const d of b.frontDecals ?? []) {
      const [dx0, dy0, dx1, dy1] = d.rect;
      this.fillPolygon([[dx0, dy0, z0], [dx1, dy0, z0], [dx1, dy1, z0], [dx0, dy1, z0]], d.color, [0, 0, -1], d.emissive ?? Emissive.None, albedoOnly);
    }
  }

  /** Screen-facing circle at constant depth, with an authored fake normal. */
  private blob(center: Vec3, radius: number, color: string, normal: Vec3) {
    const [sx, sy] = project(center);
    const r = (CAMERA.focal * radius) / viewDepth(center);
    const paint = (ctx: CanvasRenderingContext2D, style: string) => {
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    paint(this.albedo.ctx, color);
    paint(this.depth.ctx, depthColor(depthCode(center)));
    paint(this.normal.ctx, encodeNormal(normal));
    paint(this.emissive.ctx, EMISSIVE_COLOR[Emissive.None]);
  }

  /* ------------------------------------------------------------------- core */

  private fillPolygon(world: Vec3[], color: string, normal: Vec3, emissive: Emissive, albedoOnly = false) {
    const screen = world.map(project);
    const trace = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      screen.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };

    this.albedo.ctx.fillStyle = color;
    trace(this.albedo.ctx);
    if (albedoOnly) return;

    this.depth.ctx.fillStyle = affineDepthStyle(this.depth.ctx, screen, world.map(depthCode));
    trace(this.depth.ctx);

    this.normal.ctx.fillStyle = encodeNormal(normal);
    trace(this.normal.ctx);

    this.emissive.ctx.fillStyle = EMISSIVE_COLOR[emissive];
    trace(this.emissive.ctx);
  }
}

/**
 * Inverse depth over a planar polygon is an affine function v = a*x + b*y + c of screen
 * position, so a linear gradient along (a, b) reproduces it exactly. Solve (a, b) from
 * three vertices, then span the gradient between the polygon's min and max depth.
 */
function affineDepthStyle(ctx: CanvasRenderingContext2D, screen: Vec2[], codes: number[]): string | CanvasGradient {
  const [p0, p1, p2] = screen;
  const d1 = [p1[0] - p0[0], p1[1] - p0[1]];
  const d2 = [p2[0] - p0[0], p2[1] - p0[1]];
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  const vMin = Math.min(...codes);
  const vMax = Math.max(...codes);
  if (Math.abs(det) < 1e-9 || vMax - vMin < 1e-6) return depthColor(codes[0]);

  const dv1 = codes[1] - codes[0];
  const dv2 = codes[2] - codes[0];
  const a = (dv1 * d2[1] - dv2 * d1[1]) / det;
  const b = (d1[0] * dv2 - d2[0] * dv1) / det;
  const g2 = a * a + b * b;
  const at = (v: number): Vec2 => [p0[0] + (a * (v - codes[0])) / g2, p0[1] + (b * (v - codes[0])) / g2];

  const [sx, sy] = at(vMin);
  const [ex, ey] = at(vMax);
  const gradient = ctx.createLinearGradient(sx, sy, ex, ey);
  gradient.addColorStop(0, depthColor(vMin));
  gradient.addColorStop(1, depthColor(vMax));
  return gradient;
}
