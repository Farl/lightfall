/**
 * The one-point perspective that maps the authored 2.5D proxy geometry onto the
 * 2D painting. The shader mirrors `viewRay` to reconstruct world positions from
 * the depth layer, so both sides must stay in sync (see lighting.frag).
 */
import { CAMERA, SCENE_RES } from './config';
import type { Bounds } from './scene/roomData';
import { add, clamp, scale, type Vec2, type Vec3 } from './math';

/** Principal point in scene pixels. */
export const SCENE_CENTER: Vec2 = [SCENE_RES.width / 2, SCENE_RES.height * CAMERA.horizon];

export const CAMERA_POS: Vec3 = [CAMERA.x, CAMERA.y, -CAMERA.dist];

/** Distance along the view axis; the projective divisor. */
export const viewDepth = (p: Vec3) => p[2] + CAMERA.dist;

export function project(p: Vec3): Vec2 {
  const w = viewDepth(p);
  return [SCENE_CENTER[0] + (CAMERA.focal * (p[0] - CAMERA.x)) / w, SCENE_CENTER[1] - (CAMERA.focal * (p[1] - CAMERA.y)) / w];
}

/** Ray direction through a scene pixel, scaled so that `CAMERA_POS + ray * w` has view depth w. */
export function viewRay(sx: number, sy: number): Vec3 {
  return [(sx - SCENE_CENTER[0]) / CAMERA.focal, -(sy - SCENE_CENTER[1]) / CAMERA.focal, 1];
}

/** Floor (y = 0) point under a scene pixel, or null if the pixel is above the horizon. */
export function pointOnFloor(sx: number, sy: number): Vec3 | null {
  const ray = viewRay(sx, sy);
  if (ray[1] >= 0) return null;
  return add(CAMERA_POS, scale(ray, -CAMERA_POS[1] / ray[1]));
}

/**
 * Depth is stored as normalised inverse view depth: 1/w is affine in screen space
 * for any planar face, which is what lets Canvas2D linear gradients rasterise it exactly.
 */
export interface DepthRange {
  far: number;
  near: number;
}

/** Each scene spends the 8-bit depth code on its own z span. */
export const depthRange = (b: Bounds): DepthRange => ({ far: 1 / (b.depth + CAMERA.dist), near: 1 / (b.near + CAMERA.dist) });

export const depthCode = (p: Vec3, r: DepthRange) => clamp((1 / viewDepth(p) - r.far) / (r.near - r.far), 0, 1);
