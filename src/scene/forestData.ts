/**
 * Backlit forest: the sun hangs low behind the trees and shines toward the camera.
 * The opening is the far sky plane; between it and the camera stand three flat
 * silhouette layers (far canopy, middle trees, near trees). Light reaches a point
 * only through the gaps of every layer it crosses, so shafts fan out from the sun
 * and stripe the ground; the forward-scattering air makes them glow toward the sun.
 *
 * The shell is made wide and tall enough that its side walls and ceiling stay off
 * screen: all that is seen is ground, the layers, and sky.
 */
import type { Vec3 } from '../math';
import { box, Emissive, type BlobDef, type BoxDef, type Bounds, type DecalDef, type OccluderLayer, type Rect, type RoomData } from './roomData';
import { emptyShapes, mergeShapes, rng, tree, type Rng, type TreeStyle } from './shapes';

const FOREST: Bounds = { width: 26, height: 14, depth: 10, near: -1.6 };
const HALF_W = FOREST.width / 2;

const PALETTE = {
  sky: '#f3ead2',
  ground: '#3f4a2c',
  moss: ['#4a5832', '#44502e', '#38432a'],
  path: '#6b5a3e',
  /** Atmospheric perspective: far layers are hazier, near ones nearly black. */
  far: '#56624c',
  mid: '#36412f',
  near: '#1f261c',
  rock: '#5f5f57',
  leaves: ['#2b3a24', '#33452a', '#26331f'],
};

/** Silhouette layers: depth (z), shadow blur per unit distance, and leaf sway. */
const LAYERS = {
  far: { z: 9.6, softness: 0.02, wind: { amplitude: 0.05, speed: 0.9 } },
  mid: { z: 6.2, softness: 0.02, wind: { amplitude: 0.04, speed: 1.1 } },
  near: { z: 2.6, softness: 0.02, wind: { amplitude: 0.03, speed: 1.3 } },
};
/** World (x, y) area every layer texture covers: wider than the view so low sun from the side still crosses it. */
const LAYER_RECT: Rect = [-HALF_W, 0, HALF_W, 13];
const SEED = 11;

/* -------------------------------------------------------------- silhouettes */

const STYLE: Record<keyof typeof LAYERS, TreeStyle> = {
  far: { trunkHeight: 3.2, trunkWidth: 0.22, levels: 3, branchLength: 1.6, forkAngle: [0.25, 0.55], lengthDecay: 0.72, widthDecay: 0.62, leafCount: [6, 11], leafRadius: [0.35, 0.8], leafSpread: 1.1 },
  mid: { trunkHeight: 3.4, trunkWidth: 0.3, levels: 4, branchLength: 1.5, forkAngle: [0.3, 0.7], lengthDecay: 0.74, widthDecay: 0.6, leafCount: [3, 7], leafRadius: [0.18, 0.45], leafSpread: 0.6 },
  near: { trunkHeight: 2.6, trunkWidth: 0.34, levels: 4, branchLength: 1.4, forkAngle: [0.35, 0.8], lengthDecay: 0.72, widthDecay: 0.6, leafCount: [2, 5], leafRadius: [0.12, 0.3], leafSpread: 0.45 },
};

/** Low undergrowth along the bottom of a layer. */
function undergrowth(r: Rng, from: number, to: number, height: number, radius: [number, number]) {
  const s = emptyShapes();
  for (let x = from; x < to; x += r.between(0.25, 0.6)) s.discs.push({ center: [x, r.between(0, height)], radius: r.between(...radius) });
  return s;
}

function farCanopy(r: Rng) {
  // A dense band of crowns with trunks below; gaps between crowns are where the sun breaks through.
  const trees = [-11, -8.4, -6.1, -3.6, -1.3, 1.6, 3.9, 6.6, 9.1, 11.5].map((x) => tree(x + r.between(-0.4, 0.4), STYLE.far, r, r.between(-0.08, 0.08)));
  return mergeShapes(...trees, undergrowth(r, -HALF_W, HALF_W, 1.6, [0.4, 0.9]));
}

function midTrees(r: Rng) {
  const trees = [-7.2, -4.6, -2.2, 0.9, 3.4, 6.0].map((x) => tree(x + r.between(-0.3, 0.3), STYLE.mid, r, r.between(-0.12, 0.12)));
  return mergeShapes(...trees, undergrowth(r, -9, 9, 0.9, [0.25, 0.55]));
}

function nearTrees(r: Rng) {
  // Two framing trees leaning in from the sides, like standing at the edge of a clearing.
  return mergeShapes(tree(-3.3, STYLE.near, r, 0.12), tree(3.6, STYLE.near, r, -0.1));
}

const layer = (key: keyof typeof LAYERS, shapes: OccluderLayer['shapes'], color: string): OccluderLayer => ({
  axis: 2,
  at: LAYERS[key].z,
  rect: LAYER_RECT,
  shapes,
  // Backlit: the normal faces the camera, away from the sun, so the silhouettes stay dark.
  paint: { color, normal: [0, 0.25, -1] },
  softness: LAYERS[key].softness,
  wind: LAYERS[key].wind,
});

function silhouettes(): OccluderLayer[] {
  const r = rng(SEED);
  return [layer('far', farCanopy(r), PALETTE.far), layer('mid', midTrees(r), PALETTE.mid), layer('near', nearTrees(r), PALETTE.near)];
}

/* ------------------------------------------------------------------ ground */

const groundDecals = (): DecalDef[] => [
  // The whole far plane is sky: the only light source and what shows between the silhouettes.
  { plane: 'back', rect: [-HALF_W, 0, HALF_W, FOREST.height], color: PALETTE.sky, emissive: Emissive.Sky },
  { plane: 'floor', rect: [-6, 0.5, -1.8, 4.5], color: PALETTE.moss[0] },
  { plane: 'floor', rect: [1.6, 1.2, 6.5, 5.5], color: PALETTE.moss[1] },
  { plane: 'floor', rect: [-9, 5.5, 9, 10], color: PALETTE.moss[2] },
  ...[
    [-0.8, -1.6, 0.6, 1.5],
    [-0.4, 1.5, 0.9, 3.4],
    [0.1, 3.4, 1.0, 5.6],
    [-0.2, 5.6, 0.6, 10],
  ].map((rect): DecalDef => ({ plane: 'floor', rect: rect as DecalDef['rect'], color: PALETTE.path })),
];

/** Bush = a few leaf blobs plus one hidden box that casts their shadow. */
function bush(group: string, [x, y, z]: Vec3, size: number): { blobs: BlobDef[]; proxy: BoxDef } {
  const offsets: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [-0.55, -0.15, 0.1, 0.75],
    [0.55, -0.1, -0.05, 0.8],
    [0.1, 0.4, 0.15, 0.65],
  ];
  const blobs = offsets.map(([dx, dy, dz, s], i): BlobDef => ({
    center: [x + dx * size, y + dy * size, z + dz * size],
    radius: s * size * 0.6,
    color: PALETTE.leaves[i % PALETTE.leaves.length],
    // Backlit: the tops catch a little light, the faces stay in shade.
    normal: [0.2 * (dx || 0.5), 0.6, 0.75],
    group,
  }));
  const proxy = box(`${group}Proxy`, [x - size, 0, z - size * 0.5], [x + size, y + size * 0.6, z + size * 0.5], '#000000', { hidden: true, group });
  return { blobs, proxy };
}

const bushes = [bush('bushA', [-2.2, 0.4, 1.2], 0.7), bush('bushB', [2.4, 0.45, 2.0], 0.8)];

export const FOREST_DATA: RoomData = {
  bounds: FOREST,
  shell: { floor: PALETTE.ground, ceiling: PALETTE.near, back: PALETTE.sky, left: PALETTE.near, right: PALETTE.near },
  decals: groundDecals(),
  discs: [],
  boxes: [
    box('rockA', [0.9, 0, 1.0], [1.5, 0.32, 1.5], PALETTE.rock, { group: 'rocks' }),
    box('rockB', [-1.3, 0, 3.4], [-0.8, 0.24, 3.8], PALETTE.rock),
    ...bushes.map((b) => b.proxy),
  ],
  blobs: bushes.flatMap((b) => b.blobs),
  aperture: { axis: 2, at: FOREST.depth, panes: [[-HALF_W, 0, HALF_W, FOREST.height]] },
  occluders: silhouettes(),
  // Low sun behind a far plane: hang the landing handle low so it lands on the visible ground.
  lightAnchor: [0, 1.5, FOREST.depth],
  lamps: [],
};
