"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";
import { count, decimal, gameClock, percentage } from "../lib/shots";

type Format = "count" | "decimal" | "percentage" | "percentage-point" | "signed-decimal" | "distance" | "seconds" | "clock";

function signed(value: number, digits: number) {
  const magnitude = Math.abs(value).toFixed(digits);
  const sign = Number(magnitude) ? value < 0 ? "−" : "+" : "";
  return `${sign}${magnitude}`;
}

const formatters: Record<Format, (value: number) => string> = {
  count: value => count(Math.round(value)),
  decimal,
  percentage,
  "percentage-point": value => `${signed(100 * value, 1)} pp`,
  "signed-decimal": value => signed(value, 2),
  distance: value => `${value.toFixed(1)} ft`,
  seconds: value => `${value.toFixed(1)} s`,
  clock: value => gameClock(Math.round(value)),
};

export function AnimatedNumber({ value, format = "count", prefix = "", empty = "—" }: {
  value: number | null;
  format?: Format;
  prefix?: string;
  empty?: string;
}) {
  const reduced = useReducedMotion();
  const amount = useMotionValue(value ?? 0);
  const display = useTransform(() => prefix + formatters[format](amount.get()));

  useEffect(() => {
    if (reduced || value === null) {
      amount.jump(value ?? 0);
      return;
    }
    if (amount.get() === value) return;
    const controls = animate(amount, value, { duration: .42, ease: [0.2, 0, 0, 1] });
    return () => controls.stop();
  }, [amount, reduced, value]);

  if (value === null) return <span className="animated-number">{empty}</span>;
  if (reduced) return <span className="animated-number">{prefix + formatters[format](value)}</span>;
  return <motion.span className="animated-number">{display}</motion.span>;
}
