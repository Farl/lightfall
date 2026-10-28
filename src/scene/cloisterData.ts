/**
 * Gothic cloister walk: a long vaulted corridor whose left wall is an arcade of
 * pointed arches filled with stone tracery, open to a sunlit courtyard. The sun
 * comes from the courtyard side, so the tracery pattern is projected across the
 * floor and up the right wall, and the shafts carry it through the air.
 *
 * The arcade is two cut-out layers on the left wall: one with the arch openings
 * as holes (inverted), one with the tracery bars and roundels as solids. The piers
 * between the bays are proxy boxes, so they also cast shadows into the walk.
 */
import { box, Emissive, type BoxDef, type Bounds, type DecalDef, type OccluderLayer, type Rect, type RoomData } from './roomData';
import { archRise, emptyShapes, pointedArch, ring, type Rng, rng } from './shapes';

const CLOISTER: Bounds = { width: 7, height: 6, depth: 14, near: -1.6 };
const HALF_W = CLOISTER.width / 2;

const PALETTE = {
  stone: '#b3a58e',
  stoneDark: '#9a8c76',
  tracery: '#c4b69e',
  courtyard: '#e6eadc',
  ceiling: '#8f8471',
  rib: '#a99b84',
  tiles: ['#a89c8a', '#9f9381', '#b0a492'],
  stripe: '#5c5650',
  doorway: '#3b342d',
};

/** Arcade bays along the left wall (z): each is an arch opening between two piers. */
const ARCADE = {
  first: 0.4,
  bay: 2.8,
  count: 5,
  opening: 2.0,
  sill: 0.9,
  spring: 3.2,
  pierDepth: 0.35,
};
const TRACERY = { bar: 0.1, frame: 0.14, oculusRadius: 0.38, foilRadius: 0.13, oculusLift: 1.02 };
/** Shadow blur per unit distance from the stone (the sun disc); matches the scene's sunSoftness. */
const SOFTNESS = 0.008;
const TILE = 0.7;

const bayCenters = () => Array.from({ length: ARCADE.count }, (_, i) => ARCADE.first + ARCADE.opening / 2 + i * ARCADE.bay);
const pierZs = () => Array.from({ length: ARCADE.count + 1 }, (_, i) => ARCADE.first - (ARCADE.bay - ARCADE.opening) / 2 + i * ARCADE.bay);

/* ----------------------------------------------------------------- arcade */

/** Tracery of one bay: two lancets with a mullion each, the arch frame, and an oculus with a quatrefoil. */
function bayTracery(c: number) {
  const s = emptyShapes();
  const half = ARCADE.opening / 2;
  const { sill, spring } = ARCADE;
  const stroke = (points: [number, number][], width = TRACERY.bar) => s.strokes.push({ points, width });
  const archTop = (u0: number, u1: number) => pointedArch(u0, u1, spring, spring).slice(1, -1);

  stroke(pointedArch(c - half, c + half, sill, spring), TRACERY.frame);
  // Central mullion up to the apex of the two lancets, and one mullion inside each lancet.
  stroke([[c, sill], [c, spring + archRise(half)]]);
  for (const m of [c - half / 2, c + half / 2]) stroke([[m, sill], [m, spring + archRise(half / 2) * 0.9]]);
  stroke(archTop(c - half, c));
  stroke(archTop(c, c + half));
  for (const [u0, u1] of [[c - half, c - half / 2], [c - half / 2, c], [c, c + half / 2], [c + half / 2, c + half]]) stroke(archTop(u0, u1));

  const oculus: [number, number] = [c, spring + TRACERY.oculusLift];
  stroke(ring(oculus, TRACERY.oculusRadius));
  const f = TRACERY.foilRadius;
  for (const [du, dv] of [[f, 0], [-f, 0], [0, f], [0, -f]]) stroke(ring([oculus[0] + du, oculus[1] + dv], f, 14));
  return s;
}

function arcadeLayers(): OccluderLayer[] {
  const wallRect: Rect = [0, 0, CLOISTER.depth, CLOISTER.height];
  const openings = emptyShapes();
  const tracery = emptyShapes();
  for (const c of bayCenters()) {
    openings.polygons.push(pointedArch(c - ARCADE.opening / 2, c + ARCADE.opening / 2, ARCADE.sill, ARCADE.spring));
    const t = bayTracery(c);
    tracery.strokes.push(...t.strokes);
  }
  const inward: [number, number, number] = [1, 0, 0];
  return [
    // Holes in the wall; what shows through them is the bright courtyard.
    { axis: 0, at: -HALF_W + 0.01, rect: wallRect, shapes: openings, invert: true, paint: { color: PALETTE.courtyard, emissive: Emissive.Sky, normal: inward }, softness: SOFTNESS },
    { axis: 0, at: -HALF_W + 0.03, rect: wallRect, shapes: tracery, paint: { color: PALETTE.tracery, normal: inward }, softness: SOFTNESS },
  ];
}

/** Bounding rects of the arch openings: the only way light gets in (the layers then carve them). */
const arcadePanes = (): Rect[] => bayCenters().map((c) => [c - ARCADE.opening / 2, ARCADE.sill, c + ARCADE.opening / 2, ARCADE.spring + archRise(ARCADE.opening)]);

/* ---------------------------------------------------------- walls & floor */

function piers(): BoxDef[] {
  const top = CLOISTER.height - 0.05;
  const half = (ARCADE.bay - ARCADE.opening) / 2;
  return pierZs().flatMap((z, i) => [
    box(`pierL${i}`, [-HALF_W, 0, Math.max(z - half, 0)], [-HALF_W + ARCADE.pierDepth, top, Math.min(z + half, CLOISTER.depth)], PALETTE.stoneDark),
    box(`pierR${i}`, [HALF_W - ARCADE.pierDepth, 0, Math.max(z - half, 0)], [HALF_W, top, Math.min(z + half, CLOISTER.depth)], PALETTE.stoneDark),
  ]);
}

function floorTiles(r: Rng): DecalDef[] {
  const tiles: DecalDef[] = [];
  for (let x = -HALF_W; x < HALF_W; x += TILE) {
    for (let z = CLOISTER.near; z < CLOISTER.depth; z += TILE) {
      tiles.push({ plane: 'floor', rect: [x, z, Math.min(x + TILE, HALF_W), Math.min(z + TILE, CLOISTER.depth)], color: PALETTE.tiles[Math.floor(r.next() * PALETTE.tiles.length)] });
    }
  }
  // Dark inlaid bands: two along the walk and one across at every pier.
  const band = 0.14;
  for (const x of [-2.2, 2.2]) tiles.push({ plane: 'floor', rect: [x - band / 2, CLOISTER.near, x + band / 2, CLOISTER.depth], color: PALETTE.stripe });
  for (const z of pierZs()) tiles.push({ plane: 'floor', rect: [-HALF_W, z - band / 2, HALF_W, z + band / 2], color: PALETTE.stripe });
  return tiles;
}

const ceilingRibs = (): DecalDef[] => [
  { plane: 'ceiling', rect: [-0.08, CLOISTER.near, 0.08, CLOISTER.depth], color: PALETTE.rib },
  ...pierZs().map((z): DecalDef => ({ plane: 'ceiling', rect: [-HALF_W, z - 0.12, HALF_W, z + 0.12], color: PALETTE.rib })),
];

/** Right wall: a blind arcade (shallow recessed panels) answering the open one. */
const blindArcade = (): DecalDef[] =>
  bayCenters().map((c): DecalDef => ({ plane: 'right', rect: [c - ARCADE.opening / 2, ARCADE.sill, c + ARCADE.opening / 2, ARCADE.spring + 1.2], color: PALETTE.stoneDark }));

export const CLOISTER_DATA: RoomData = {
  bounds: CLOISTER,
  shell: { floor: PALETTE.tiles[0], ceiling: PALETTE.ceiling, back: PALETTE.stone, left: PALETTE.stone, right: PALETTE.stone },
  decals: [
    ...floorTiles(rng(23)),
    ...ceilingRibs(),
    ...blindArcade(),
    { plane: 'back', rect: [-0.9, 0, 0.9, 2.9], color: PALETTE.doorway },
  ],
  discs: [],
  boxes: piers(),
  blobs: [],
  aperture: { axis: 0, at: -HALF_W, panes: arcadePanes() },
  occluders: arcadeLayers(),
  lamps: [],
};
