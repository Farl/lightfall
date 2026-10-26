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

/** `near` < 0 extends the shell behind the opening so floor and ceiling run off-screen. */
export const ROOM = { width: 8, height: 3.4, depth: 5, near: -1.6 };

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

/** Open glass of the window on the left wall, in (z, y). The light source shines only through these. */
export interface PaneDef {
  zMin: number;
  yMin: number;
  zMax: number;
  yMax: number;
}

export interface RoomData {
  shell: Record<Plane, string>;
  decals: DecalDef[];
  discs: DiscDef[];
  boxes: BoxDef[];
  blobs: BlobDef[];
  windowX: number;
  panes: PaneDef[];
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

function windowPanes(): PaneDef[] {
  const { z0, z1, y0, y1, frame, mullion } = WINDOW;
  const mid = (z0 + z1) / 2;
  return [
    { zMin: Math.max(z0 + frame, z0 + CURTAIN.overlap), yMin: y0 + frame, zMax: mid - mullion / 2, yMax: y1 - frame },
    { zMin: mid + mullion / 2, yMin: y0 + frame, zMax: Math.min(z1 - frame, z1 - CURTAIN.overlap), yMax: y1 - frame },
  ];
}

const box = (name: string, min: Vec3, max: Vec3, color: string, extra: Partial<BoxDef> = {}): BoxDef => ({ name, min, max, color, ...extra });

export const ROOM_DATA: RoomData = {
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
  windowX: -HALF_W,
  panes: windowPanes(),
  lamps: [
    [-1.6, ROOM.height - 0.12, 3.0],
    [1.8, ROOM.height - 0.12, 3.0],
  ],
};

/** Map plane-local (u, v) to world space. */
export function planePoint(plane: Plane, u: number, v: number): Vec3 {
  switch (plane) {
    case 'floor':
      return [u, 0, v];
    case 'ceiling':
      return [u, ROOM.height, v];
    case 'back':
      return [u, v, ROOM.depth];
    case 'left':
      return [-HALF_W, v, u];
    case 'right':
      return [HALF_W, v, u];
  }
}

export const PLANE_NORMAL: Record<Plane, Vec3> = {
  floor: [0, 1, 0],
  ceiling: [0, -1, 0],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

/** Room shell rect per plane in its own (u, v). */
export const PLANE_EXTENT: Record<Plane, [number, number, number, number]> = {
  floor: [-HALF_W, ROOM.near, HALF_W, ROOM.depth],
  ceiling: [-HALF_W, ROOM.near, HALF_W, ROOM.depth],
  back: [-HALF_W, 0, HALF_W, ROOM.height],
  left: [ROOM.near, 0, ROOM.depth, ROOM.height],
  right: [ROOM.near, 0, ROOM.depth, ROOM.height],
};

/** Center of all window panes; the anchor of the "direct light landing point" handle. */
export function windowCenter(room: RoomData): Vec3 {
  const z = room.panes.reduce((s, p) => s + (p.zMin + p.zMax) / 2, 0) / room.panes.length;
  const y = room.panes.reduce((s, p) => s + (p.yMin + p.yMax) / 2, 0) / room.panes.length;
  return [room.windowX, y, z];
}
