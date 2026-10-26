/**
 * 幾何資料 overlay: draws the authored proxy data over the image and owns the
 * draggable 直射光落點 (direct light landing point) handle.
 */
import { OUTPUT_SCALE, OVERLAY, SCENE_RES } from './config';
import { pointOnFloor, project } from './camera';
import { directionToLanding, landingPoint } from './lighting';
import { add, scale, type Vec2, type Vec3 } from './math';
import { windowCenter, type RoomData } from './scene/roomData';

const DASH = [4, 4];

export class DebugOverlay {
  private ctx: CanvasRenderingContext2D;
  private dragging = false;
  private handle: Vec2 | null = null;

  constructor(private canvas: HTMLCanvasElement, private room: RoomData, onDrag: (toLight: Vec3) => void) {
    canvas.width = SCENE_RES.width * OUTPUT_SCALE;
    canvas.height = SCENE_RES.height * OUTPUT_SCALE;
    this.ctx = canvas.getContext('2d')!;

    const toScene = (e: PointerEvent): Vec2 => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * SCENE_RES.width, ((e.clientY - r.top) / r.height) * SCENE_RES.height];
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.handle) return;
      const [sx, sy] = toScene(e);
      const dx = (sx - this.handle[0]) * OUTPUT_SCALE;
      const dy = (sy - this.handle[1]) * OUTPUT_SCALE;
      if (Math.hypot(dx, dy) > OVERLAY.handleRadius * 2) return;
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const p = pointOnFloor(...toScene(e));
      // Keep the landing point inside the room, in front of the window wall.
      if (p && p[0] > room.windowX + 0.2) onDrag(directionToLanding(room, p));
    });
    const stop = () => (this.dragging = false);
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  setVisible(visible: boolean) {
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  draw(toLight: Vec3) {
    const ctx = this.ctx;
    const s = OUTPUT_SCALE;
    const P = (p: Vec3): Vec2 => {
      const [x, y] = project(p);
      return [x * s, y * s];
    };
    const line = (a: Vec3, b: Vec3) => {
      ctx.beginPath();
      ctx.moveTo(...P(a));
      ctx.lineTo(...P(b));
      ctx.stroke();
    };

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = OVERLAY.lineColor;
    ctx.setLineDash([]);

    // Proxy boxes as wireframes.
    for (const b of this.room.boxes) {
      const [x0, y0, z0] = b.min;
      const [x1, y1, z1] = b.max;
      const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, e] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) line(c[a], c[e]);
    }

    // Window panes and the rays from their corners down to the floor.
    ctx.strokeStyle = OVERLAY.accent;
    const x = this.room.windowX;
    for (const p of this.room.panes) {
      const corners: Vec3[] = [[x, p.yMin, p.zMin], [x, p.yMin, p.zMax], [x, p.yMax, p.zMax], [x, p.yMax, p.zMin]];
      corners.forEach((c, i) => line(c, corners[(i + 1) % 4]));
      if (toLight[1] > 0) {
        ctx.setLineDash(DASH);
        for (const c of corners) line(c, add(c, scale(toLight, -c[1] / toLight[1])));
        ctx.setLineDash([]);
      }
    }

    const land = landingPoint(this.room, toLight);
    this.handle = land ? project(land) : null;
    if (!land) return;
    ctx.setLineDash(DASH);
    ctx.strokeStyle = OVERLAY.lineColor;
    line(windowCenter(this.room), land);
    ctx.setLineDash([]);

    const [hx, hy] = P(land);
    ctx.fillStyle = OVERLAY.accent;
    ctx.beginPath();
    ctx.arc(hx, hy, OVERLAY.handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(OVERLAY.label, hx + OVERLAY.handleRadius + 4, hy - OVERLAY.handleRadius);
  }
}
