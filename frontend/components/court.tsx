"use client";

import { Box, Crosshair, Play, RotateCcw, RotateCw, Square } from "lucide-react";
import { animate, motion, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { courtPosition, type Shot } from "../lib/shots";
import type { ShotBin } from "../lib/archive-query";
import { flightPoint, flightTiming, type CourtView, type PointOnScreen } from "../lib/court-scene";
import { AnimatedNumber } from "./animated-number";
import { paintCourt } from "./court-art";
import { Button, Segment } from "./ui";

type PlotSide = "a" | "b";
type Mark = { shot: Shot; location: NonNullable<ReturnType<typeof courtPosition>>; sides: PlotSide[] };
type ScreenMark = { mark: Mark; point: PointOnScreen };
type ScreenBin = { bin: ShotBin; point: PointOnScreen; radius: number };
type Playback = { shots: Mark[]; timing: ReturnType<typeof flightTiming>; still: boolean };
const cameraOptions = [{ value: "spatial", label: "3D", icon: <Box size={14} /> }, { value: "overhead", label: "Top down", icon: <Crosshair size={14} /> }] as const;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(notify: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export function Court({ first, second, density, selectedBin, selected, player, comparisonPlayer, view, onViewChange, onSelect, onSelectBin, ready = true }: {
  first: Shot[];
  second: Shot[];
  density?: ShotBin[];
  selectedBin?: string;
  onSelectBin?: (id: string) => void;
  selected: string | undefined;
  player: string;
  comparisonPlayer?: string;
  view: CourtView;
  onViewChange: (view: CourtView) => void;
  onSelect: (shot: Shot) => void;
  ready?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenMarks = useRef<ScreenMark[]>([]);
  const screenBins = useRef<ScreenBin[]>([]);
  const renderFrame = useRef<() => void>(() => {});
  const playback = useRef<Playback | null>(null);
  const controller = useRef<AnimationPlaybackControls | null>(null);
  const rotation = useRef<AnimationPlaybackControls | null>(null);
  const yaw = useMotionValue(-.31);
  const clock = useMotionValue(1);
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
  const subscribe = useCallback((notify: () => void) => clock.on("change", notify), [clock]);
  const playing = useSyncExternalStore(subscribe, () => clock.get() < 1, () => false);
  const lastPlayers = useRef({ player, comparisonPlayer });
  const drag = useRef<{ x: number; yaw: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  const marks = useMemo(() => {
    const byId = new Map<string, Mark>();
    for (const [side, shots] of [["a", first], ["b", second]] as const) {
      for (const shot of shots) {
        const location = courtPosition(shot);
        if (!location) continue;
        const existing = byId.get(shot.id);
        if (existing) existing.sides.push(side);
        else byId.set(shot.id, { shot, location, sides: [side] });
      }
    }
    return byId;
  }, [first, second]);
  const chosen = selected ? marks.get(selected) : undefined;

  const play = useCallback((shots: Mark[]) => {
    controller.current?.stop();
    const timing = flightTiming(shots.length);
    playback.current = shots.length ? { shots, timing, still: Boolean(reduced) } : null;
    if (reduced || !shots.length) clock.jump(1);
    else {
      clock.jump(0);
      controller.current = animate(clock, 1, { ease: "linear", duration: timing.total });
    }
    renderFrame.current();
  }, [clock, reduced]);

  useEffect(() => {
    if (!ready) {
      play([]);
      return;
    }
    const previous = lastPlayers.current;
    lastPlayers.current = { player, comparisonPlayer };
    const changed = previous.player !== player ? player : previous.comparisonPlayer !== comparisonPlayer ? comparisonPlayer : undefined;
    const group = changed && !reduced ? [...marks.values()].filter(mark => mark.shot.player === changed) : [];
    play(group.length ? group : chosen ? [chosen] : []);
  }, [chosen, comparisonPlayer, marks, play, player, ready, reduced]);

  useEffect(() => () => { controller.current?.stop(); rotation.current?.stop(); }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const base = document.createElement("canvas");
    const staticContext = base.getContext("2d");
    if (!canvas || !ctx || !staticContext) return;

    function build() {
      const width = canvas!.clientWidth;
      const height = canvas!.clientHeight;
      if (width < 45 || height < 50) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = base.width = Math.round(width * ratio);
      canvas!.height = base.height = Math.round(height * ratio);
      const style = getComputedStyle(canvas!);
      const token = (name: string) => style.getPropertyValue(name).trim();
      staticContext!.setTransform(ratio, 0, 0, ratio, 0, 0);
      const camera = paintCourt(staticContext!, width, height, view, yaw.get(), token);
      const colors = { a: [token("--plot-a-miss"), token("--plot-a-make")], b: [token("--plot-b-miss"), token("--plot-b-make")] };
      const color = (mark: Mark, side: PlotSide) => colors[side][Number(mark.shot.made)];
      const screen = [...marks.values()].map(mark => ({ mark, point: camera.project([mark.location.x, mark.location.y, 0]) }));
      const markerSize = width < 420 ? 3 : 4;
      const bg = staticContext!;

      const bins = (density ?? []).map(bin => ({
        bin,
        point: camera.project([bin.x, bin.y, 0]),
        radius: Math.min(11, 2 + Math.log1p(bin.makes + bin.misses)),
      }));
      for (const { bin, point: [x, y], radius } of bins) {
        const size = bin.makes + bin.misses;
        let angle = 0;
        bg.globalAlpha = bin.id === selectedBin ? .95 : .54;
        for (const [index, shots] of [bin.misses, bin.makes].entries()) {
          if (!shots) continue;
          const end = angle + (shots / size) * Math.PI * 2;
          bg.beginPath();
          bg.moveTo(x, y);
          bg.arc(x, y, radius, angle, end);
          bg.closePath();
          bg.fillStyle = colors.b[index];
          bg.fill();
          angle = end;
        }
      }
      bg.globalAlpha = 1;
      const activeBin = bins.find(({ bin }) => bin.id === selectedBin);
      if (activeBin) {
        bg.beginPath();
        bg.arc(...activeBin.point, activeBin.radius + 2, 0, Math.PI * 2);
        bg.strokeStyle = token("--plot-selection");
        bg.lineWidth = 2;
        bg.stroke();
      }
      screenBins.current = bins;

      function drawMarker({ mark, point: [x, y] }: ScreenMark) {
        const active = mark === chosen;
        if (active) {
          bg.globalAlpha = 1;
          bg.beginPath();
          bg.arc(x, y, markerSize + 4.5, 0, Math.PI * 2);
          bg.fillStyle = token("--court");
          bg.fill();
          bg.lineWidth = 1.4;
          bg.strokeStyle = token("--plot-selection");
          bg.stroke();
        }
        bg.globalAlpha = active ? 1 : .82;
        bg.lineWidth = 1.55;
        bg.lineCap = "round";
        mark.sides.forEach((side, index) => {
          bg.save();
          if (mark.sides.length === 2) {
            const edge = markerSize + 2;
            bg.beginPath();
            bg.rect(index ? x : x - edge, y - edge, edge, edge * 2);
            bg.clip();
          }
          bg.beginPath();
          if (mark.shot.made) {
            bg.fillStyle = color(mark, side);
            bg.arc(x, y, markerSize, 0, Math.PI * 2);
            bg.fill();
          } else {
            const arm = markerSize * .75;
            bg.strokeStyle = color(mark, side);
            bg.moveTo(x - arm, y - arm); bg.lineTo(x + arm, y + arm);
            bg.moveTo(x + arm, y - arm); bg.lineTo(x - arm, y + arm);
            bg.stroke();
          }
          bg.restore();
        });
      }

      for (const entry of screen) if (entry.mark !== chosen) drawMarker(entry);
      const active = screen.find(entry => entry.mark === chosen);
      if (active) drawMarker(active);
      screenMarks.current = screen;

      const context = ctx!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const ballCenter = token("--plot-selection");
      function path(mark: Mark, progress: number, alpha: number, head: boolean) {
        if (progress <= 0 || alpha <= 0) return;
        const sections = Math.max(1, Math.ceil(progress * 24));
        context.globalAlpha = alpha;
        context.beginPath();
        for (let i = 0; i <= sections; i++) {
          const point = camera.project(flightPoint(mark.location, mark.shot.made, progress * i / sections));
          if (i) context.lineTo(...point);
          else context.moveTo(...point);
        }
        context.lineWidth = head ? 2.4 : 1.65;
        context.lineCap = "round";
        context.strokeStyle = color(mark, mark.sides[0]);
        context.stroke();
        if (mark.sides.length === 2) {
          context.setLineDash([3, 4]);
          context.strokeStyle = color(mark, "b");
          context.stroke();
          context.setLineDash([]);
        }
        if (head) {
          const [x, y] = camera.project(flightPoint(mark.location, mark.shot.made, progress));
          context.beginPath();
          context.fillStyle = color(mark, mark.sides[0]);
          context.arc(x, y, 4.4, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.fillStyle = ballCenter;
          context.arc(x - .8, y - .8, 2, 0, Math.PI * 2);
          context.fill();
        }
      }

      function selectedPath(mark: Mark, progress: number, inFlight: boolean) {
        if (view === "spatial") {
          context.globalAlpha = .48;
          context.strokeStyle = color(mark, mark.sides[0]);
          context.lineWidth = 1;
          context.setLineDash([2, 4]);
          context.beginPath();
          context.moveTo(...camera.project([mark.location.x, mark.location.y, 0]));
          context.lineTo(...camera.project(flightPoint(mark.location, mark.shot.made, 0)));
          context.stroke();
          context.setLineDash([]);
        }
        path(mark, progress, .94, inFlight);
      }

      renderFrame.current = () => {
        context.globalAlpha = 1;
        context.drawImage(base, 0, 0, width, height);
        const run = playback.current;
        if (!run) return;
        const progress = clock.get();
        if (run.shots.length === 1) {
          selectedPath(run.shots[0], progress, progress < 1);
        } else if (run.still) {
          for (const mark of run.shots) path(mark, 1, .16, false);
        } else if (progress < 1) {
          const { flight, gap, tail, total } = run.timing;
          const time = total * progress;
          const start = Math.max(0, Math.ceil((time - flight - tail) / gap));
          const end = Math.min(run.shots.length - 1, Math.floor(time / gap));
          for (let index = start; index <= end; index++) {
            const elapsed = time - index * gap;
            const flying = elapsed < flight;
            path(run.shots[index], Math.min(1, elapsed / flight), flying ? .72 : .36 * (1 - (elapsed - flight) / tail), flying);
          }
        } else if (chosen) {
          selectedPath(chosen, 1, false);
        }
      };
      renderFrame.current();
    }

    const observer = new ResizeObserver(build);
    const themeObserver = new MutationObserver(build);
    observer.observe(canvas);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const unsubscribeYaw = yaw.on("change", build);
    const unsubscribeClock = clock.on("change", () => renderFrame.current());
    build();
    return () => { observer.disconnect(); themeObserver.disconnect(); unsubscribeYaw(); unsubscribeClock(); renderFrame.current = () => {}; };
  }, [chosen, clock, density, marks, selectedBin, view, yaw]);

  function nearest(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let hit: { mark: Mark } | { bin: ShotBin } | undefined;
    let distance = Infinity;
    for (const { mark, point } of screenMarks.current) {
      const candidate = Math.hypot(point[0] - x, point[1] - y);
      if (candidate < 11 && candidate < distance) { hit = { mark }; distance = candidate; }
    }
    if (onSelectBin) {
      for (const { bin, point, radius } of screenBins.current) {
        const candidate = Math.hypot(point[0] - x, point[1] - y);
        if (candidate <= radius + 4 && candidate < distance) { hit = { bin }; distance = candidate; }
      }
    }
    return hit;
  }

  function rotate(by: number) {
    rotation.current?.stop();
    const target = yaw.get() + by;
    if (reduced) yaw.jump(target);
    else rotation.current = animate(yaw, target, { duration: .35, ease: [0.2, 0, 0, 1] });
  }

  return <div className="court-viewer">
    <div className="court-toolbar">
      <div className="court-camera">
        <Segment label="Court angle" options={cameraOptions} value={view} onChange={onViewChange} />
        {view === "spatial" && <><Button variant="icon" aria-label="Rotate court left" title="Rotate court left" onClick={() => rotate(-.31)}><RotateCcw size={15} /></Button><Button variant="icon" aria-label="Rotate court right" title="Rotate court right" onClick={() => rotate(.31)}><RotateCw size={15} /></Button></>}
      </div>
      <div className="court-playback">
        <Button variant="ghost" disabled={!chosen} onClick={() => { if (chosen) play([chosen]); }}><Play size={13} />{reduced ? "Show shot path" : "Replay shot"}</Button>
        {playing ? <Button variant="secondary" onClick={() => play([])}><Square size={12} />Stop</Button> : <Button disabled={!marks.size} onClick={() => play([...marks.values()])}><Play size={13} />{density ? reduced ? "Show individual paths" : "Play individual shots" : reduced ? "Show all paths" : "Play all"} <span className="play-count"><AnimatedNumber value={marks.size} /></span></Button>}
      </div>
    </div>
    <div className="court-frame" data-view={view}>
      <canvas ref={canvasRef} className="shot-court" role="img" aria-label={density ? "Frontcourt shot plot. Select a benchmark bin on the court or use the Benchmark bin menu to browse its shots." : "Frontcourt shot plot. Circles are makes and crosses are misses. Flight paths are illustrative. Use the shot list for keyboard selection."}
        onPointerDown={event => {
          skipClick.current = false;
          if (view !== "spatial" || event.button !== 0) return;
          rotation.current?.stop();
          drag.current = { x: event.clientX, yaw: yaw.get(), moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const held = drag.current;
          if (held && (held.moved || Math.abs(event.clientX - held.x) > 5)) {
            held.moved = true;
            yaw.jump(held.yaw + (event.clientX - held.x) * .008);
            event.currentTarget.style.cursor = "grabbing";
          } else event.currentTarget.style.cursor = nearest(event.clientX, event.clientY) ? "pointer" : view === "spatial" ? "grab" : "default";
        }}
        onPointerUp={() => { skipClick.current = Boolean(drag.current?.moved); drag.current = null; }}
        onPointerCancel={() => { drag.current = null; skipClick.current = true; }}
        onClick={event => {
          if (skipClick.current) return;
          const hit = nearest(event.clientX, event.clientY);
          if (!hit) return;
          if ("bin" in hit) onSelectBin?.(hit.bin.id);
          else if (hit.mark === chosen) play([hit.mark]);
          else onSelect(hit.mark.shot);
        }} />
      <span className="flight-note">Illustrative shot paths</span>
      {playing && <motion.span className="flight-progress" style={{ scaleX: clock }} aria-hidden="true" />}
    </div>
  </div>;
}
