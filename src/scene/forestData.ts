/**
 * Forest clearing: the same shell-of-planes idea as the room, read as outdoors.
 * The ceiling is the canopy and the only opening: a masked aperture whose leaf gaps
 * let the sun through, so beams and floor dapples come from the mask instead of a
 * window. The far planes are painted as receding tree lines; trunks are proxy boxes
 * that throw real shadows across the dapples.
 */
import type { Vec3 } from '../math';
import { box, Emissive, type BlobDef, type BoxDef, type Bounds, type DecalDef, type DiscDef, type MaskDef, type RoomData } from './roomData';

const FOREST: Bounds = { width: 12, height: 6, depth: 9, near: -1.6 };
const HALF_W = FOREST.width / 2;

const PALETTE = {
  ground: '#4b5634',
  moss: ['#56663a', '#5f6f3f', '#46532f'],
  litter: '#6a5638',
  path: '#7d6848',
  canopy: '#1d2a1b',
  gap: '#d9ead8',
  farTrees: '#33463a',
  farTrunk: '#425246',
  sideTrees: '#26362a',
  sideTrunk: '#334332',
  trunk: ['#4d4236', '#453c31', '#574a3b'],
  rock: '#7b7a70',
  leaves: ['#3f6a35', '#4c7a3b', '#365c2f', '#5b8a45'],
};

/* ------------------------------------------------------------------ canopy */

/**
 * The mask has to cover where low sun rays cross the canopy, which reaches well
 * beyond the visible shell (sun from the left: far to -x, plus the azimuth swing in z).
 */
const CANOPY = {
  rect: [-17, -7, 7, 17] as [number, number, number, number],
  resolution: [1024, 1024] as [number, number],
  seed: 7,
  /** Sparse on purpose: every point of the air sees the canopy, so coverage turns straight into haze. */
  clusters: 75,
  holesPerCluster: [3, 9],
  clusterSpread: 0.9,
  /** Small gaps mostly add floor dapples; their shafts stay thin and faint. */
  holeRadius: [0.035, 0.13],
  /** A few large gaps make the strong shafts. */
  bigGaps: 7,
  bigGapRadius: [0.22, 0.4],
  softness: 0.012,
  wind: { amplitude: 0.05, speed: 1.1 },
};

/** Deterministic RNG (mulberry32) so the canopy is the same on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canopyMask(): MaskDef {
  const random = rng(CANOPY.seed);
  const between = ([lo, hi]: number[]) => lo + random() * (hi - lo);
  const [u0, v0, u1, v1] = CANOPY.rect;
  const holes: MaskDef['holes'] = [];
  const at = (): [number, number] => [between([u0, u1]), between([v0, v1])];
  for (let c = 0; c < CANOPY.clusters; c++) {
    const [cu, cv] = at();
    const n = Math.round(between(CANOPY.holesPerCluster));
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2;
      const d = Math.sqrt(random()) * CANOPY.clusterSpread;
      holes.push({ center: [cu + Math.cos(a) * d, cv + Math.sin(a) * d], radius: between(CANOPY.holeRadius) });
    }
  }
  for (let i = 0; i < CANOPY.bigGaps; i++) holes.push({ center: at(), radius: between(CANOPY.bigGapRadius) });
  return { rect: CANOPY.rect, resolution: CANOPY.resolution, holes, softness: CANOPY.softness, wind: CANOPY.wind };
}

const MASK = canopyMask();

/** Leaf gaps lying wholly on the visible canopy are painted as bright sky specks. */
const canopyGaps = (): DiscDef[] =>
  MASK.holes
    .filter(({ center: [x, z], radius }) => Math.abs(x) < HALF_W - radius && z > FOREST.near + radius && z < FOREST.depth - radius)
    .map(({ center, radius }) => ({ plane: 'ceiling', center, radius, color: PALETTE.gap, emissive: Emissive.Sky }));

/* ----------------------------------------------------------------- ground */

const groundDecals = (): DecalDef[] => [
  // Moss and leaf-litter patches, then a winding dirt path drawn as offset steps.
  { plane: 'floor', rect: [-5.5, 0.5, -2.2, 3.5], color: PALETTE.moss[0] },
  { plane: 'floor', rect: [2.0, 1.0, 5.5, 4.2], color: PALETTE.moss[1] },
  { plane: 'floor', rect: [-4.5, 5.0, -1.0, 8.5], color: PALETTE.moss[2] },
  { plane: 'floor', rect: [1.5, 5.5, 4.8, 8.8], color: PALETTE.litter },
  ...[
    [-0.9, -1.6, 0.5, 1.2],
    [-0.6, 1.2, 0.8, 3.0],
    [-0.1, 3.0, 1.1, 4.8],
    [0.2, 4.8, 1.2, 6.6],
    [-0.2, 6.6, 0.8, 9.0],
  ].map((rect): DecalDef => ({ plane: 'floor', rect: rect as DecalDef['rect'], color: PALETTE.path })),
];

/** Distant trunks as vertical strips on the far planes (the tree line fading into haze). */
function treeLine(): DecalDef[] {
  const strips: DecalDef[] = [];
  const random = rng(CANOPY.seed + 1);
  for (let x = -HALF_W + 0.4; x < HALF_W; x += 0.7 + random() * 0.9) {
    const w = 0.12 + random() * 0.22;
    strips.push({ plane: 'back', rect: [x, 0, x + w, FOREST.height], color: PALETTE.farTrunk });
  }
  for (const plane of ['left', 'right'] as const) {
    for (let z = 0.5; z < FOREST.depth; z += 0.8 + random() * 1.0) {
      const w = 0.18 + random() * 0.3;
      strips.push({ plane, rect: [z, 0, z + w, FOREST.height], color: PALETTE.sideTrunk });
    }
  }
  return strips;
}

/* ------------------------------------------------------------------ props */

/** Trunks stop just under the canopy so edit clamping (EDITOR.wallMargin) never sinks them. */
const TRUNK_TOP = FOREST.height - 0.05;

const trunks: [string, number, number, number][] = [
  // name, x, z, half width
  ['trunkA', -4.3, 2.0, 0.34],
  ['trunkB', -1.9, 5.4, 0.26],
  ['trunkC', 1.6, 2.6, 0.4],
  ['trunkD', 3.9, 6.6, 0.3],
  ['trunkE', 4.9, 1.2, 0.45],
  ['trunkF', -3.2, 7.8, 0.22],
  ['trunkG', 0.4, 8.1, 0.2],
];

const trunkBoxes = (): BoxDef[] =>
  trunks.map(([name, x, z, r], i) => box(name, [x - r, 0, z - r], [x + r, TRUNK_TOP, z + r], PALETTE.trunk[i % PALETTE.trunk.length]));

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
    normal: [0.2 * (dx || 0.5), 0.75, -0.6],
    group,
  }));
  const proxy = box(`${group}Proxy`, [x - size, 0, z - size * 0.5], [x + size, y + size * 0.6, z + size * 0.5], '#000000', { hidden: true, group });
  return { blobs, proxy };
}

const bushes = [bush('bushA', [-2.6, 0.45, 3.0], 0.75), bush('bushB', [2.9, 0.5, 4.8], 0.85), bush('bushC', [-5.0, 0.55, 6.2], 0.9)];

export const FOREST_DATA: RoomData = {
  bounds: FOREST,
  shell: { floor: PALETTE.ground, ceiling: PALETTE.canopy, back: PALETTE.farTrees, left: PALETTE.sideTrees, right: PALETTE.sideTrees },
  decals: [...groundDecals(), ...treeLine()],
  discs: canopyGaps(),
  boxes: [
    ...trunkBoxes(),
    box('rockA', [0.6, 0, 1.3], [1.25, 0.38, 1.85], PALETTE.rock, { group: 'rocks' }),
    box('rockB', [1.1, 0, 1.6], [1.45, 0.22, 2.0], PALETTE.rock, { group: 'rocks' }),
    box('rockC', [-1.4, 0, 4.0], [-0.8, 0.28, 4.45], PALETTE.rock),
    ...bushes.map((b) => b.proxy),
  ],
  blobs: bushes.flatMap((b) => b.blobs),
  aperture: { axis: 1, at: FOREST.height, panes: [MASK.rect], mask: MASK },
  lamps: [],
};
