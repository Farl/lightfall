/**
 * Live editing of the proxy geometry. Moving a box changes the painting, the
 * G-buffer and the shadow casters at once, which is the easiest way to show the
 * lighting is computed from the 2.5D data and not painted in.
 *
 * Pieces are edited per group (BoxDef.group / BlobDef.group, default = name),
 * so a sofa or the plant moves as one object.
 */
import { EDITOR } from '../config';
import { CAMERA_POS, viewRay } from '../camera';
import { add, clamp, dot, scale, sub, type Vec3 } from '../math';
import { ROOM, type BlobDef, type BoxDef, type RoomData } from './roomData';

export const groupOf = (item: BoxDef | BlobDef) => item.group ?? ('name' in item ? item.name : '');

/** Group of the nearest visible box or blob under a scene pixel. */
export function pickGroup(room: RoomData, sx: number, sy: number): string | null {
  const d = viewRay(sx, sy);
  let best = Infinity;
  let hit: string | null = null;
  for (const b of room.boxes) {
    if (b.hidden) continue;
    const t = rayBox(CAMERA_POS, d, b.min, b.max);
    if (t < best) [best, hit] = [t, groupOf(b)];
  }
  for (const b of room.blobs) {
    const t = raySphere(CAMERA_POS, d, b.center, b.radius);
    if (t < best) [best, hit] = [t, groupOf(b)];
  }
  return hit;
}

/** Axis-aligned bounds of everything in a group. */
export function groupBounds(room: RoomData, group: string): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (lo: Vec3, hi: Vec3) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], lo[i]);
      max[i] = Math.max(max[i], hi[i]);
    }
  };
  room.boxes.filter((b) => groupOf(b) === group).forEach((b) => grow(b.min, b.max));
  room.blobs.filter((b) => groupOf(b) === group).forEach((b) => grow(sub(b.center, [b.radius, b.radius, b.radius]), add(b.center, [b.radius, b.radius, b.radius])));
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** Translate a group, clamped so its bounds stay inside the room. */
export function moveGroup(room: RoomData, group: string, delta: Vec3) {
  const bounds = groupBounds(room, group);
  if (!bounds) return;
  const m = EDITOR.wallMargin;
  const lo: Vec3 = [-ROOM.width / 2 + m, 0, 0 + m];
  const hi: Vec3 = [ROOM.width / 2 - m, ROOM.height - m, ROOM.depth - m];
  const d = delta.map((v, i) => clamp(v, lo[i] - bounds.min[i], hi[i] - bounds.max[i])) as Vec3;

  for (const b of room.boxes) {
    if (groupOf(b) !== group) continue;
    b.min = add(b.min, d);
    b.max = add(b.max, d);
    // Front decals are authored in absolute (x, y); carry them along.
    for (const fd of b.frontDecals ?? []) fd.rect = [fd.rect[0] + d[0], fd.rect[1] + d[1], fd.rect[2] + d[0], fd.rect[3] + d[1]];
  }
  for (const b of room.blobs) if (groupOf(b) === group) b.center = add(b.center, d);
}

let addedCount = 0;

/** Add a plain box at the spawn point; returns its group, or null when the shader's box budget is full. */
export function addBox(room: RoomData, maxBoxes: number): string | null {
  if (room.boxes.length >= maxBoxes) return null;
  const [w, h, dpt] = EDITOR.newBoxSize;
  const [x, z] = EDITOR.newBoxSpawn;
  const name = `custom${++addedCount}`;
  room.boxes.push({
    name,
    min: [x - w / 2, 0, z - dpt / 2],
    max: [x + w / 2, h, z + dpt / 2],
    color: EDITOR.newBoxColors[(addedCount - 1) % EDITOR.newBoxColors.length],
    overpaint: true,
  });
  return name;
}

export function removeGroup(room: RoomData, group: string) {
  room.boxes = room.boxes.filter((b) => groupOf(b) !== group);
  room.blobs = room.blobs.filter((b) => groupOf(b) !== group);
}

/** Overwrite `room` in place with a fresh copy of `source` (keeps references held elsewhere valid). */
export function resetRoom(room: RoomData, source: RoomData) {
  Object.assign(room, structuredClone(source));
}

/* ---------------------------------------------------------------- ray tests */

function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number {
  let near = -Infinity;
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
      continue;
    }
    let t0 = (min[i] - o[i]) / d[i];
    let t1 = (max[i] - o[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
  }
  return near <= far && near > 0 ? near : Infinity;
}

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const oc = sub(o, c);
  const a = dot(d, d);
  const b = dot(oc, d);
  const disc = b * b - a * (dot(oc, oc) - r * r);
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t > 0 ? t : Infinity;
}

export const liftDelta = (notches: number): Vec3 => scale([0, 1, 0], notches * EDITOR.liftStep);
