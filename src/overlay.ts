/**
 * 幾何資料 overlay: draws the authored proxy data over the image, owns the
 * draggable 直射光落點 (direct light landing point) handle, and edits the proxy
 * geometry (click to select, drag to move along the floor, wheel to lift).
 */
import { EDITOR, OUTPUT_SCALE, OVERLAY, SCENE_RES } from './config';
import { pointOnFloor, project } from './camera';
import { directionToLanding, landingPoint } from './lighting';
import { add, scale, type Vec2, type Vec3 } from './math';
import { windowCenter, type RoomData } from './scene/roomData';
import { groupOf, liftDelta, moveGroup, pickGroup } from './scene/editing';

export interface OverlayCallbacks {
  onLightDrag(toLight: Vec3): void;
  /** Proxy geometry changed; layers and GPU data need a rebuild. */
  onEdit(): void;
}

type Drag = { kind: 'light' } | { kind: 'group'; group: string; last: Vec3 };

const DASH = [4, 4];

export class DebugOverlay {
  private ctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private handle: Vec2 | null = null;
  selected: string | null = null;

  constructor(private canvas: HTMLCanvasElement, private room: RoomData, cb: OverlayCallbacks) {
    canvas.width = SCENE_RES.width * OUTPUT_SCALE;
    canvas.height = SCENE_RES.height * OUTPUT_SCALE;
    this.ctx = canvas.getContext('2d')!;

    const toScene = (e: PointerEvent): Vec2 => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * SCENE_RES.width, ((e.clientY - r.top) / r.height) * SCENE_RES.height];
    };
    canvas.addEventListener('pointerdown', (e) => {
      const [sx, sy] = toScene(e);
      const onHandle = this.handle && Math.hypot(sx - this.handle[0], sy - this.handle[1]) * OUTPUT_SCALE <= OVERLAY.handleRadius * 2;
      if (onHandle) {
        this.drag = { kind: 'light' };
      } else {
        this.selected = pickGroup(this.room, sx, sy);
        const start = pointOnFloor(sx, sy);
        this.drag = this.selected && start ? { kind: 'group', group: this.selected, last: start } : null;
      }
      if (this.drag) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const p = pointOnFloor(...toScene(e));
      if (!p) return;
      if (this.drag.kind === 'light') {
        // Keep the landing point inside the room, in front of the window wall.
        if (p[0] > room.windowX + 0.2) cb.onLightDrag(directionToLanding(room, p));
        return;
      }
      // Floor-plane delta: objects slide along x/z and keep their height.
      moveGroup(this.room, this.drag.group, [p[0] - this.drag.last[0], 0, p[2] - this.drag.last[2]]);
      this.drag.last = p;
      cb.onEdit();
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.selected) return;
      e.preventDefault();
      moveGroup(this.room, this.selected, liftDelta(-Math.sign(e.deltaY)));
      cb.onEdit();
    }, { passive: false });
    const stop = () => (this.drag = null);
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

    // Proxy boxes as wireframes; the selected group is highlighted.
    for (const b of this.room.boxes) {
      const isSelected = groupOf(b) === this.selected;
      ctx.strokeStyle = isSelected ? EDITOR.selectedColor : OVERLAY.lineColor;
      ctx.lineWidth = isSelected ? 2 : 1;
      const [x0, y0, z0] = b.min;
      const [x1, y1, z1] = b.max;
      const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, e] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) line(c[a], c[e]);
    }
    ctx.lineWidth = 1;

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
