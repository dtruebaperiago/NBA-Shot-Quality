import type { ModelMetric } from "./model-study";

function quantile(values: number[], fraction: number) {
  const index = (values.length - 1) * fraction;
  const start = Math.floor(index);
  return values[start] + (values[Math.ceil(index)] - values[start]) * (index - start);
}

export function modelAxis(values: number[], metric: ModelMetric, spread: boolean) {
  const sorted = values.toSorted((a, b) => a - b);
  const first = sorted[0] ?? 0;
  const last = sorted.at(-1) ?? first;
  const step = metric === "fg" ? (last - first <= .5 ? .05 : .10) : (last - first <= 1 ? .10 : .25);
  const limit = metric === "fg" ? 1 : 3;
  const min = Math.max(0, Math.floor((first - step / 4) / step) * step);
  const max = Math.min(limit, Math.ceil((last + step / 4) / step) * step);
  const middleMin = sorted.length > 1 ? quantile(sorted, .10) : first;
  const middleMax = sorted.length > 1 ? quantile(sorted, .90) : last;
  const stretched = spread && min < middleMin && middleMin < middleMax && middleMax < max && middleMax - middleMin < .72 * (max - min);
  const breaks = stretched ? [min, middleMin, middleMax, max] : [min, max];

  function position(value: number) {
    if (!stretched) return 100 * (value - min) / (max - min);
    if (value <= middleMin) return 14 * (value - min) / (middleMin - min);
    if (value >= middleMax) return 86 + 14 * (value - middleMax) / (max - middleMax);
    return 14 + 72 * (value - middleMin) / (middleMax - middleMin);
  }

  const ticks = [min];
  for (let index = Math.round(min / step) + 1; index < Math.round(max / step); index++) {
    const tick = index * step;
    if (position(tick) - position(ticks.at(-1)!) >= 11 && position(tick) <= 89) ticks.push(tick);
  }
  ticks.push(max);
  return { min, max, breaks, position, ticks };
}

export function equalityLine(x: ReturnType<typeof modelAxis>, y: ReturnType<typeof modelAxis>) {
  const low = Math.max(x.min, y.min);
  const high = Math.min(x.max, y.max);
  if (high <= low) return "";
  const knots = [...new Set([low, ...x.breaks, ...y.breaks, high])].filter(value => value >= low && value <= high).sort((a, b) => a - b);
  return knots.map(value => `${x.position(value)},${100 - y.position(value)}`).join(" ");
}
