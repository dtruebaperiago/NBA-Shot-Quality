import { courtBounds } from "./shots.ts";

export type CourtPoint = readonly [x: number, depth: number, height: number];
export type CourtView = "spatial" | "overhead";
export type PointOnScreen = readonly [x: number, y: number];

export const rimHeight = 100;
const { left, right, top, bottom } = courtBounds;
const depthCenter = (top + bottom) / 2;

export function courtCamera(width: number, height: number, view: CourtView, yaw: number) {
  if (view === "overhead") {
    const scale = Math.min((width - 32) / (right - left), (height - 24) / (bottom - top));
    return { scale, project: ([x, y]: CourtPoint): PointOnScreen => [width / 2 + x * scale, height / 2 + (y - depthCenter) * scale] };
  }

  const sine = Math.sin(yaw);
  const cosine = Math.cos(yaw);
  const pitch = .76;
  const rise = Math.cos(pitch);
  const depth = Math.sin(pitch);
  function rotate([x, y, z]: CourtPoint): PointOnScreen {
    const offset = y - depthCenter;
    return [x * cosine - offset * sine, (x * sine + offset * cosine) * depth - z * rise];
  }

  const corners: CourtPoint[] = [[left, top, 0], [right, top, 0], [left, bottom, -18], [right, bottom, -18], [-35, top, 145], [35, top, 145]];
  const frame = corners.map(rotate);
  const minX = Math.min(...frame.map(([x]) => x));
  const maxX = Math.max(...frame.map(([x]) => x));
  const minY = Math.min(...frame.map(([, y]) => y));
  const maxY = Math.max(...frame.map(([, y]) => y));
  const scale = Math.min((width - 42) / (maxX - minX), (height - 48) / (maxY - minY));
  return {
    scale,
    project(point: CourtPoint): PointOnScreen {
      const [x, y] = rotate(point);
      return [width / 2 + (x - (minX + maxX) / 2) * scale, height / 2 + (y - (minY + maxY) / 2) * scale];
    },
  };
}

export function flightPoint(start: { x: number; y: number }, made: boolean, progress: number): CourtPoint {
  const t = Math.max(0, Math.min(1, progress));
  const release = 67;
  const lift = Math.min(116, 29 + Math.hypot(start.x, start.y) * .23);
  const endX = made ? 0 : (start.x < 0 ? -1 : 1) * 14;
  const endDepth = made ? 0 : 7;
  const height = release + (rimHeight - release) * t + 4 * lift * t * (1 - t);
  return [start.x + (endX - start.x) * t, start.y + (endDepth - start.y) * t, height];
}

export function flightTiming(attempts: number) {
  if (attempts <= 1) {
    const flight = .62;
    return { flight, gap: 0, tail: 0, total: flight };
  }

  const intervals = attempts - 1;
  // Compress the launch spacing as the sample grows, while still playing every shot.
  const launchWindow = 8.6 * (1 - Math.exp(-intervals / 185));
  const flight = Math.max(.34, .57 - Math.log2(attempts) * .022);
  const tail = .14;
  return { flight, gap: launchWindow / intervals, tail, total: launchWindow + flight + tail };
}
