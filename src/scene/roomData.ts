/**
 * The room: a flat-colored "painting" plus the 2.5D proxy data the lighting needs.
 *
 * This is the stand-in for what the original post calls 模擬 2.5D 的幾何光影資料:
 * no mesh, no 3D renderer. Every element is a rectangle on one of the room's planes,
 * an axis-aligned box, or a sphere-ish blob. The painter draws them as 2D polygons;
 * the same data is rasterised into depth/normal layers and uploaded to the shader
 * as shadow casters and window apertures.
 *
 * World units ~ meters. x in [-width/2, width/2], y in [0, height], z in [near, depth].
 */
import type { Vec3 } from '../math';

/** Scene shell size. `near` < 0 extends the shell behind the opening so floor and ceiling run off-screen. */
export interface Bounds {
  width: number;
  height: number;
  depth: number;
  near: number;
}

const ROOM: Bounds = { width: 8, height: 3.4, depth: 5, near: -1.6 };

const HALF_W = ROOM.width / 2;

/** Emissive kinds; each gets its own channel in the emissive layer (see layers.ts). */
export enum Emissive {
  None = 0,
  Sky = 1,
  Lamp = 2,
  Tv = 3,
}

/** Room shell planes. Rect coordinates (u, v): floor/ceiling (x, z), back (x, y), left/right (z, y). */
export type Plane = 'floor' | 'ceiling' | 'back' | 'left' | 'right';

export interface DecalDef {
  plane: Plane;
  rect: [number, number, number, number];
  color: string;
  emissive?: Emissive;
}

export interface DiscDef {
  plane: Plane;
  center: [number, number];
  radius: number;
  color: string;
  emissive?: Emissive;
}

export interface BoxDef {
  name: string;
  min: Vec3;
  max: Vec3;
  color: string;
  /** Invisible shadow proxy (e.g. plant foliage drawn as blobs). */
  hidden?: boolean;
  /** Pieces sharing a group move together when edited. Defaults to `name`. */
  group?: string;
  /** Painted even over an external base painting (boxes added at runtime are not in the AI art). */
  overpaint?: boolean;
  /** Rects (x0, y0, x1, y1) painted on the camera-facing face. */
  frontDecals?: { rect: [number, number, number, number]; color: string; emissive?: Emissive }[];
}

export interface BlobDef {
  center: Vec3;
  radius: number;
  color: string;
  /** Painted foliage has no real normal; this fake one decides how much sun it catches. */
  normal: Vec3;
  group?: string;
}

/** Axis-aligned rect (u0, v0, u1, v1) in a plane's own coordinates. */
export type Rect = [number, number, number, number];

/**
 * Leaf gaps of a canopy: the open parts of a masked aperture. Rasterised into a
 * texture whose mip level is chosen by distance, so spots blur the farther they
 * land from the leaves (sun-disc "pinhole" dapples, 木漏れ日).
 */
export interface MaskDef {
  /** Aperture (u, v) area the texture covers; outside it the canopy is closed. */
  rect: Rect;
  /** Texture size in texels. */
  resolution: [number, number];
  holes: { center: [number, number]; radius: number }[];
  /** Blur radius = distance from the canopy * this (angular size of the sun disc). */
  softness: number;
  /** Sway of the mask in world units, and its angular speed. */
  wind: { amplitude: number; speed: number };
}

/**
 * The opening the sun/moon shines through: an axis-aligned plane with open rects.
 *   axis 0 (x = at): a wall window, panes in (z, y)
 *   axis 1 (y = at): a canopy overhead, panes in (x, z)
 * With a mask, light inside a pane is further multiplied by the leaf-gap texture.
 */
export interface ApertureDef {
  axis: 0 | 1;
  at: number;
  panes: Rect[];
  mask?: MaskDef;
}

export interface RoomData {
  bounds: Bounds;
  shell: Record<Plane, string>;
  decals: DecalDef[];
  discs: DiscDef[];
  boxes: BoxDef[];
  blobs: BlobDef[];
  aperture: ApertureDef;
  lamps: Vec3[];
}

/** Flat "painted" face shading for boxes: top catches more ambient, sides less. */
export const FACE_SHADE = { top: 1.08, side: 0.86, front: 1, bottom: 0.7 };

const PALETTE = {
  wallBack: '#f4dcc6',
  wallSide: '#eccfb8',
  ceiling: '#e8cbb1',
  floor: '#a26d56',
  floorAlt: ['#a26d56', '#97644f', '#ad775e'],
  baseboard: '#c49a7e',
  molding: '#f6e5d3',
  windowFrame: '#d6b398',
  glass: '#dfeaf6',
  curtain: '#c7837a',
  wood: '#b98a68',
  woodDark: '#8c5f45',
  sofa: '#efe1d3',
  cushion: '#c47c6c',
};

/** Floor plank strips: width in x and the alternating palette. */
const PLANK_WIDTH = 0.42;

function floorPlanks(): DecalDef[] {
  const planks: DecalDef[] = [];
  const count = Math.ceil(ROOM.width / PLANK_WIDTH);
  for (let i = 0; i < count; i++) {
    const x0 = -HALF_W + i * PLANK_WIDTH;
    planks.push({ plane: 'floor', rect: [x0, ROOM.near, Math.min(x0 + PLANK_WIDTH, HALF_W), ROOM.depth], color: PALETTE.floorAlt[i % PALETTE.floorAlt.length] });
  }
  return planks;
}

/** A thin strip along the bottom (baseboard) and top (molding) of each wall. */
function wallTrims(): DecalDef[] {
  const base = 0.12;
  const mold = 0.1;
  const h = ROOM.height;
  return [
    { plane: 'back', rect: [-HALF_W, 0, HALF_W, base], color: PALETTE.baseboard },
    { plane: 'left', rect: [ROOM.near, 0, ROOM.depth, base], color: PALETTE.baseboard },
    { plane: 'right', rect: [ROOM.near, 0, ROOM.depth, base], color: PALETTE.baseboard },
    { plane: 'back', rect: [-HALF_W, h - mold, HALF_W, h], color: PALETTE.molding },
    { plane: 'left', rect: [ROOM.near, h - mold, ROOM.depth, h], color: PALETTE.molding },
    { plane: 'right', rect: [ROOM.near, h - mold, ROOM.depth, h], color: PALETTE.molding },
  ];
}

const WINDOW = { z0: 1.3, z1: 3.3, y0: 1.0, y1: 2.6, frame: 0.08, mullion: 0.08 };
const CURTAIN = { width: 0.38, overlap: 0.2, drop: 0.1 };

function windowDecals(): DecalDef[] {
  const { z0, z1, y0, y1, frame, mullion } = WINDOW;
  const mid = (z0 + z1) / 2;
  return [
    { plane: 'left', rect: [z0, y0, z1, y1], color: PALETTE.windowFrame },
    { plane: 'left', rect: [z0 + frame, y0 + frame, mid - mullion / 2, y1 - frame], color: PALETTE.glass, emissive: Emissive.Sky },
    { plane: 'left', rect: [mid + mullion / 2, y0 + frame, z1 - frame, y1 - frame], color: PALETTE.glass, emissive: Emissive.Sky },
    // Curtains hang over the frame edges; the panes below exclude what they cover.
    { plane: 'left', rect: [z0 - CURTAIN.width + CURTAIN.overlap, y0 - CURTAIN.drop, z0 + CURTAIN.overlap, y1 + CURTAIN.drop], color: PALETTE.curtain },
    { plane: 'left', rect: [z1 - CURTAIN.overlap, y0 - CURTAIN.drop, z1 + CURTAIN.width - CURTAIN.overlap, y1 + CURTAIN.drop], color: PALETTE.curtain },
    { plane: 'left', rect: [z0 - CURTAIN.width, y1 + CURTAIN.drop, z1 + CURTAIN.width, y1 + CURTAIN.drop + 0.05], color: PALETTE.woodDark },
  ];
}

/** Open glass of the window on the left wall, in (z, y). */
function windowPanes(): Rect[] {
  const { z0, z1, y0, y1, frame, mullion } = WINDOW;
  const mid = (z0 + z1) / 2;
  return [
    [Math.max(z0 + frame, z0 + CURTAIN.overlap), y0 + frame, mid - mullion / 2, y1 - frame],
    [mid + mullion / 2, y0 + frame, Math.min(z1 - frame, z1 - CURTAIN.overlap), y1 - frame],
  ];
}

export const box = (name: string, min: Vec3, max: Vec3, color: string, extra: Partial<BoxDef> = {}): BoxDef => ({ name, min, max, color, ...extra });

export const ROOM_DATA: RoomData = {
  bounds: ROOM,
  shell: { floor: PALETTE.floor, ceiling: PALETTE.ceiling, back: PALETTE.wallBack, left: PALETTE.wallSide, right: PALETTE.wallSide },
  decals: [
    ...floorPlanks(),
    ...wallTrims(),
    ...windowDecals(),
    { plane: 'floor', rect: [-2.8, 2.0, -0.9, 3.6], color: '#c48d7c' },
    // Back wall: picture frames over the sofa, kitchen doorway with a noren, bathroom door.
    { plane: 'back', rect: [-2.6, 1.6, -2.05, 2.25], color: '#7a5a46' },
    { plane: 'back', rect: [-2.53, 1.67, -2.12, 2.18], color: '#efe4d2' },
    { plane: 'back', rect: [-1.75, 1.75, -0.95, 2.3], color: '#7a5a46' },
    { plane: 'back', rect: [-1.68, 1.82, -1.02, 2.23], color: '#e9b9b0' },
    { plane: 'back', rect: [0.3, 0, 1.35, 2.15], color: '#c89f86' },
    { plane: 'back', rect: [0.35, 1.5, 1.3, 2.1], color: '#efe3cf' },
    { plane: 'back', rect: [2.6, 0, 3.4, 2.0], color: '#d9d0b4' },
    { plane: 'back', rect: [2.75, 0.2, 3.25, 0.45], color: '#b9af93' },
    { plane: 'back', rect: [3.28, 0.9, 3.34, 0.98], color: '#8c8470' },
    // Right wall: entrance door.
    { plane: 'right', rect: [1.3, 0, 2.5, 2.15], color: '#b26b5c' },
    { plane: 'right', rect: [1.4, 0.95, 1.47, 1.08], color: '#e8e2da' },
  ],
  discs: [
    { plane: 'back', center: [1.85, 2.25], radius: 0.2, color: '#efece6' },
    { plane: 'ceiling', center: [-1.6, 3.0], radius: 0.5, color: '#c9a68c' },
    { plane: 'ceiling', center: [-1.6, 3.0], radius: 0.43, color: '#fff3e2', emissive: Emissive.Lamp },
    { plane: 'ceiling', center: [1.8, 3.0], radius: 0.5, color: '#c9a68c' },
    { plane: 'ceiling', center: [1.8, 3.0], radius: 0.43, color: '#fff3e2', emissive: Emissive.Lamp },
  ],
  boxes: [
    // Plant under the front half of the window: stand, pot, and an invisible foliage proxy for the leaf shadow.
    box('plantStand', [-3.85, 0, 1.45], [-3.5, 0.5, 1.8], PALETTE.woodDark, { group: 'plant' }),
    box('pot', [-3.8, 0.5, 1.5], [-3.55, 0.75, 1.75], '#e9e2d6', { group: 'plant' }),
    box('foliage', [-3.98, 0.85, 1.3], [-3.3, 1.5, 1.95], '#000000', { hidden: true, group: 'plant' }),
    // Low TV stand by the window; the beam grazes it and throws its shadow across the patch.
    box('tvStand', [-3.8, 0, 2.0], [-2.95, 0.36, 2.75], '#9b7056', { group: 'tv' }),
    box('tv', [-3.65, 0.36, 2.1], [-3.1, 0.9, 2.65], '#4c4745', {
      group: 'tv',
      frontDecals: [
        { rect: [-3.57, 0.45, -3.25, 0.82], color: '#3a3836' },
        { rect: [-3.21, 0.48, -3.15, 0.8], color: '#2f2b2a', emissive: Emissive.Tv },
      ],
    }),
    // Coffee table beside the rug, out of the patch so the patch stays visible from this low camera.
    box('tableTop', [-0.9, 0.3, 2.9], [0.2, 0.36, 3.4], '#b8835f', { group: 'table' }),
    box('tableLeg', [-0.45, 0, 3.07], [-0.25, 0.3, 3.23], PALETTE.woodDark, { group: 'table' }),
    // Sofa against the back wall.
    box('sofaSeat', [-2.9, 0, 4.25], [-0.9, 0.4, 4.95], PALETTE.sofa, { group: 'sofa' }),
    box('sofaBack', [-2.9, 0.4, 4.7], [-0.9, 0.85, 4.95], PALETTE.sofa, { group: 'sofa' }),
    box('sofaArmL', [-2.9, 0.4, 4.25], [-2.68, 0.58, 4.7], PALETTE.sofa, { group: 'sofa' }),
    box('sofaArmR', [-1.12, 0.4, 4.25], [-0.9, 0.58, 4.7], PALETTE.sofa, { group: 'sofa' }),
    box('cushion', [-2.3, 0.46, 4.58], [-1.5, 0.76, 4.7], PALETTE.cushion, { group: 'sofa' }),
    // Side table, books, coat rack.
    box('sideTable', [-0.7, 0, 4.4], [-0.1, 0.52, 4.95], PALETTE.wood, { group: 'sideTable', frontDecals: [{ rect: [-0.62, 0.26, -0.18, 0.29], color: '#8c6448' }] }),
    box('books', [-0.6, 0.52, 4.55], [-0.36, 0.74, 4.75], '#6aa06a', { group: 'sideTable' }),
    box('coatRack', [0.08, 0, 4.4], [0.15, 1.55, 4.47], PALETTE.woodDark),
    // Low cabinet with a vase, shoe cabinet by the entrance.
    box('cabinet', [1.5, 0, 4.55], [2.4, 0.72, 4.95], '#c8a27e', { group: 'cabinet', frontDecals: [{ rect: [1.93, 0.08, 1.97, 0.64], color: '#9e7a5a' }] }),
    box('vase', [1.88, 0.72, 4.68], [2.02, 1.02, 4.82], '#d9744f', { group: 'cabinet' }),
    box('shoeCabinet', [3.25, 0, 3.2], [3.98, 0.95, 4.9], '#e8dccb'),
  ],
  blobs: [
    { center: [-3.68, 1.0, 1.62], radius: 0.3, color: '#4f8f4a', normal: [0.3, 0.6, -0.74], group: 'plant' },
    { center: [-3.45, 1.2, 1.5], radius: 0.22, color: '#5fa257', normal: [0.5, 0.6, -0.62], group: 'plant' },
    { center: [-3.85, 1.25, 1.75], radius: 0.25, color: '#3f7c3f', normal: [0.2, 0.7, -0.68], group: 'plant' },
    { center: [-3.6, 1.36, 1.72], radius: 0.17, color: '#68ab5e', normal: [0.4, 0.8, -0.45], group: 'plant' },
  ],
  aperture: { axis: 0, at: -HALF_W, panes: windowPanes() },
  lamps: [
    [-1.6, ROOM.height - 0.12, 3.0],
    [1.8, ROOM.height - 0.12, 3.0],
  ],
};

/* --------------------------------------------------------- plane helpers */

/** Map plane-local (u, v) to world space. */
export function planePoint(b: Bounds, plane: Plane, u: number, v: number): Vec3 {
  switch (plane) {
    case 'floor':
      return [u, 0, v];
    case 'ceiling':
      return [u, b.height, v];
    case 'back':
      return [u, v, b.depth];
    case 'left':
      return [-b.width / 2, v, u];
    case 'right':
      return [b.width / 2, v, u];
  }
}

export const PLANE_NORMAL: Record<Plane, Vec3> = {
  floor: [0, 1, 0],
  ceiling: [0, -1, 0],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

/** Shell rect of a plane in its own (u, v). */
export function planeExtent(b: Bounds, plane: Plane): Rect {
  const hw = b.width / 2;
  if (plane === 'floor' || plane === 'ceiling') return [-hw, b.near, hw, b.depth];
  if (plane === 'back') return [-hw, 0, hw, b.height];
  return [b.near, 0, b.depth, b.height];
}

/* ------------------------------------------------------- aperture helpers */

/** Shell plane an aperture lies on (the wall window or the canopy ceiling). */
export const aperturePlane = (a: ApertureDef): Plane => (a.axis === 0 ? (a.at < 0 ? 'left' : 'right') : 'ceiling');

/** Aperture-plane (u, v) to world space. */
export const aperturePoint = (a: ApertureDef, u: number, v: number): Vec3 => (a.axis === 0 ? [a.at, v, u] : [u, a.at, v]);

/** World point to aperture-plane (u, v). */
export const apertureUv = (a: ApertureDef, p: Vec3): [number, number] => (a.axis === 0 ? [p[2], p[1]] : [p[0], p[2]]);

/** Panes clipped to the visible shell plane (a canopy mask can extend far beyond the shell). */
export function visiblePanes(room: RoomData): Rect[] {
  const [eu0, ev0, eu1, ev1] = planeExtent(room.bounds, aperturePlane(room.aperture));
  return room.aperture.panes
    .map(([u0, v0, u1, v1]): Rect => [Math.max(u0, eu0), Math.max(v0, ev0), Math.min(u1, eu1), Math.min(v1, ev1)])
    .filter(([u0, v0, u1, v1]) => u0 < u1 && v0 < v1);
}

/** Center of the visible panes; the anchor of the "direct light landing point" handle. */
export function apertureCenter(room: RoomData): Vec3 {
  const panes = visiblePanes(room);
  const mean = (pick: (r: Rect) => number) => panes.reduce((s, r) => s + pick(r), 0) / panes.length;
  return aperturePoint(room.aperture, mean((r) => (r[0] + r[2]) / 2), mean((r) => (r[1] + r[3]) / 2));
}

/** +1 or -1: which side of the aperture plane the inside of the scene is on. */
export const apertureInward = (room: RoomData) => {
  const a = room.aperture;
  const inside = a.axis === 0 ? 0 : room.bounds.height / 2;
  return Math.sign(inside - a.at);
};
