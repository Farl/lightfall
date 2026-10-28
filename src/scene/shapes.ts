/**
 * 2D shape toolkit for occluder layers: generators (trees, gothic tracery), the
 * polygon outlines used to paint a layer in perspective, and its rasterisation
 * into the (u, v) shadow texture. Painting and texture come from the same shapes,
 * so what you see is exactly what blocks the light.
 */
import type { LayerShapes, OccluderLayer, Uv } from './roomData';

/** Segments of a disc outline when painted. */
const DISC_SEGMENTS = 14;

export const emptyShapes = (): LayerShapes => ({ strokes: [], discs: [], polygons: [] });

export function mergeShapes(...all: LayerShapes[]): LayerShapes {
  return { strokes: all.flatMap((s) => s.strokes), discs: all.flatMap((s) => s.discs), polygons: all.flatMap((s) => s.polygons) };
}

/** Deterministic RNG (mulberry32), so generated scenes are identical on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, between: (lo: number, hi: number) => lo + next() * (hi - lo) };
}
export type Rng = ReturnType<typeof rng>;

/* --------------------------------------------------------------- painting */

const circle = ([cu, cv]: Uv, r: number, n = DISC_SEGMENTS): Uv[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cu + Math.cos(a) * r, cv + Math.sin(a) * r];
  });

/** Every shape as filled polygons: strokes become one quad per segment plus round joints. */
export function shapeOutlines(shapes: LayerShapes): Uv[][] {
  const out: Uv[][] = [...shapes.polygons];
  for (const { points, width } of shapes.strokes) {
    const h = width / 2;
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [nx, ny] = [(-(b[1] - a[1]) / len) * h, ((b[0] - a[0]) / len) * h];
      out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
    }
    for (const p of points) out.push(circle(p, h, 8));
  }
  for (const d of shapes.discs) out.push(circle(d.center, d.radius));
  return out;
}

/* -------------------------------------------------------------- rasterise */

/**
 * Solid coverage of a layer (white = blocks light) into `ctx`, rows growing down from
 * the top of the rect (v1). An inverted layer starts solid and its shapes are cut out.
 */
export function rasterizeLayer(layer: OccluderLayer, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const [u0, v0, u1, v1] = layer.rect;
  const sx = w / (u1 - u0);
  const sy = h / (v1 - v0);
  const X = (u: number) => (u - u0) * sx;
  const Y = (v: number) => (v1 - v) * sy;
  const [bg, fg] = layer.invert ? ['#fff', '#000'] : ['#000', '#fff'];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const poly of layer.shapes.polygons) {
    ctx.beginPath();
    poly.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
    ctx.closePath();
    ctx.fill();
  }
  for (const { points, width } of layer.shapes.strokes) {
    ctx.lineWidth = width * sx;
    ctx.beginPath();
    points.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
    ctx.stroke();
  }
  for (const { center, radius } of layer.shapes.discs) {
    ctx.beginPath();
    ctx.ellipse(X(center[0]), Y(center[1]), radius * sx, radius * sy, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ trees */

export interface TreeStyle {
  /** Height of the bare trunk before it first forks. */
  trunkHeight: number;
  trunkWidth: number;
  /** Branching generations after the trunk. */
  levels: number;
  branchLength: number;
  /** Fork angle range from the parent direction, radians. */
  forkAngle: [number, number];
  /** Child length / width relative to the parent. */
  lengthDecay: number;
  widthDecay: number;
  /** Leaf clumps at each twig tip: count and radius range. */
  leafCount: [number, number];
  leafRadius: [number, number];
  leafSpread: number;
}

/** A tree silhouette rooted at (x, 0): a wobbly trunk that forks recursively, leaf clumps at the tips. */
export function tree(x: number, style: TreeStyle, r: Rng, lean = 0): LayerShapes {
  const shapes = emptyShapes();
  const grow = (from: Uv, angle: number, length: number, width: number, level: number) => {
    const bend = r.between(-0.15, 0.15);
    const mid: Uv = [from[0] + Math.sin(angle + bend) * length * 0.5, from[1] + Math.cos(angle + bend) * length * 0.5];
    const end: Uv = [mid[0] + Math.sin(angle - bend) * length * 0.5, mid[1] + Math.cos(angle - bend) * length * 0.5];
    shapes.strokes.push({ points: [from, mid, end], width });
    if (level >= style.levels) {
      const n = Math.round(r.between(...style.leafCount));
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = Math.sqrt(r.next()) * style.leafSpread;
        shapes.discs.push({ center: [end[0] + Math.cos(a) * d, end[1] + Math.sin(a) * d * 0.7], radius: r.between(...style.leafRadius) });
      }
      return;
    }
    const forks = r.next() < 0.3 ? 3 : 2;
    for (let i = 0; i < forks; i++) {
      const side = forks === 2 ? (i ? 1 : -1) : i - 1;
      const spread = r.between(...style.forkAngle);
      // The trunk forks into limbs of branchLength; every later generation shrinks by lengthDecay.
      const childLength = (level === 0 ? style.branchLength : length * style.lengthDecay) * r.between(0.8, 1.15);
      grow(end, angle + side * spread + r.between(-0.1, 0.1), childLength, width * style.widthDecay, level + 1);
    }
  };
  grow([x, 0], lean, style.trunkHeight, style.trunkWidth, 0);
  return shapes;
}

/* -------------------------------------------------------- gothic tracery */

/** Points along a ring (closed polyline), for oculi and foils drawn as strokes. */
export const ring = (center: Uv, radius: number, n = 20): Uv[] => [...circle(center, radius, n), circle(center, radius, n)[0]];

/**
 * Equilateral pointed arch over [u0, u1] springing at v = spring: two arcs centred on the
 * opposite jambs. Returns the closed outline from the bottom-left (v = sill) round to the bottom-right.
 */
export function pointedArch(u0: number, u1: number, sill: number, spring: number, n = 10): Uv[] {
  const w = u1 - u0;
  const left: Uv[] = [];
  const right: Uv[] = [];
  // Arc around the right jamb draws the left half, and the other way round; they meet at the apex.
  const apexAngle = Math.PI / 3;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * apexAngle;
    left.push([u1 - Math.cos(a) * w, spring + Math.sin(a) * w]);
    right.push([u0 + Math.cos(a) * w, spring + Math.sin(a) * w]);
  }
  return [[u0, sill], ...left, ...right.reverse(), [u1, sill]];
}

/** Height of a pointed arch's apex above its springing line. */
export const archRise = (width: number) => width * Math.sin(Math.PI / 3);
