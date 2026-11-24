import { courtBounds } from "../lib/shots";
import { courtCamera, rimHeight, type CourtPoint, type CourtView } from "../lib/court-scene";

const { left, right, top, bottom } = courtBounds;

export function paintCourt(ctx: CanvasRenderingContext2D, width: number, height: number, view: CourtView, yaw: number, color: (name: string) => string) {
  const camera = courtCamera(width, height, view, yaw);
  const { project } = camera;
  const spatial = view === "spatial";

  function path(points: CourtPoint[], { fill, stroke, closed = false }: { fill?: string; stroke?: string; closed?: boolean }) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const [x, y] = project(point);
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (closed) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  const ink = color("--court-line");
  const line = (a: CourtPoint, b: CourtPoint, stroke = ink) => path([a, b], { stroke });
  const floorRect = (x1: number, y1: number, x2: number, y2: number): CourtPoint[] => [[x1, y1, 0], [x2, y1, 0], [x2, y2, 0], [x1, y2, 0]];
  const arc = (x: number, y: number, radius: number, start: number, end: number, z = 0, stroke = ink) => {
    const points: CourtPoint[] = [];
    for (let i = 0; i <= 56; i++) {
      const theta = start + (end - start) * i / 56;
      points.push([x + radius * Math.cos(theta), y + radius * Math.sin(theta), z]);
    }
    path(points, { stroke });
  };

  ctx.fillStyle = color("--court");
  if (spatial) {
    const light = ctx.createRadialGradient(width * .45, height * .45, 0, width * .48, height * .49, width * .65);
    light.addColorStop(0, color("--court-studio"));
    light.addColorStop(1, color("--court-apron"));
    ctx.fillStyle = light;
  }
  ctx.fillRect(0, 0, width, height);

  const floor = floorRect(left, top, right, bottom);
  if (spatial) {
    const drop = (point: CourtPoint): CourtPoint => [point[0], point[1], -18];
    const side = (index: number, next: number, fill: string) => path([floor[index], floor[next], drop(floor[next]), drop(floor[index])], { fill, closed: true, stroke: color("--court-edge") });
    side(0, 1, color("--court-apron"));
    side(1, 2, color("--court-edge"));
    side(3, 0, color("--court-apron"));
    side(2, 3, color("--court-edge"));
    path(floor, { closed: true, fill: color("--court-floor") });
  }
  path(floorRect(-80, top, 80, 137.5), { closed: true, fill: color("--court-key") });
  ctx.lineWidth = spatial ? 1 : .9;
  ctx.globalAlpha = spatial ? .16 : .12;
  for (let y = -40; y < bottom; y += 10) line([left, y, 0], [right, y, 0]);
  ctx.globalAlpha = .78;
  path(floor, { closed: true, stroke: ink });
  path(floorRect(-80, top, 80, 137.5), { closed: true, stroke: ink });
  path(floorRect(-60, top, 60, 137.5), { closed: true, stroke: ink });

  const cornerStart = Math.acos(220 / 237.5);
  const cornerDepth = Math.sin(cornerStart) * 237.5;
  line([-220, top, 0], [-220, cornerDepth, 0]);
  line([220, top, 0], [220, cornerDepth, 0]);
  arc(0, 0, 237.5, cornerStart, Math.PI - cornerStart);
  arc(0, 137.5, 60, 0, Math.PI);
  ctx.setLineDash([4, 4]);
  arc(0, 137.5, 60, Math.PI, 2 * Math.PI);
  ctx.setLineDash([]);
  arc(0, 0, 40, 0, Math.PI);
  arc(0, bottom, 60, Math.PI, 2 * Math.PI);

  if (!spatial) {
    arc(0, 0, 7.5, 0, 2 * Math.PI);
    line([-30, -15, 0], [30, -15, 0]);
    if (project([left, 0, 0])[0] > 43) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color("--court-label");
      ctx.font = `10px ${color("--font-data")}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let y = 0; y <= 300; y += 100) {
        line([left - 4, y, 0], [left, y, 0]);
        const [x, py] = project([left - 9, y, 0]);
        ctx.fillText(`${y / 10} ft`, x, py);
      }
    }
  } else {
    const board = color("--court-board");
    const rim = color("--court-rim");
    ctx.globalAlpha = .84;
    ctx.lineWidth = 2.4;
    line([0, -46, 0], [0, -46, 118], board);
    line([0, -46, 118], [0, -16, 118], board);
    ctx.lineWidth = 1.15;
    path([[-30, -16, 94], [30, -16, 94], [30, -16, 130], [-30, -16, 130]], { closed: true, stroke: board, fill: "#b7d6d329" });
    path([[-10, -16, 100], [10, -16, 100], [10, -16, 116], [-10, -16, 116]], { closed: true, stroke: board });
    ctx.globalAlpha = .5;
    for (let i = 0; i < 10; i++) {
      const theta = i * 2 * Math.PI / 10;
      const next = theta + Math.PI / 10;
      line([Math.cos(theta) * 8, Math.sin(theta) * 8, rimHeight], [Math.cos(next) * 4, Math.sin(next) * 4, rimHeight - 12], board);
    }
    arc(0, 0, 4, 0, 2 * Math.PI, rimHeight - 12, board);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    arc(0, 0, 8, 0, 2 * Math.PI, rimHeight, rim);
  }

  ctx.globalAlpha = 1;
  return camera;
}
