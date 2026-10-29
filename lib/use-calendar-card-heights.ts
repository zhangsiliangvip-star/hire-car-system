"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export function useCalendarCardHeights(
  scroller: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  scale = 1,
) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    if (!enabled || !scroller.current) return;
    const contents = Array.from(
      scroller.current.querySelectorAll<HTMLElement>("[data-calendar-card-vehicle]"),
    );
    const measure = () => {
      const next: Record<string, number> = {};
      for (const content of contents) {
        const vehicleId = content.dataset.calendarCardVehicle;
        if (!vehicleId) continue;
        next[vehicleId] = Math.max(next[vehicleId] ?? 56, Math.ceil(content.offsetHeight / scale) + 10);
      }
      setHeights((current) =>
        Object.keys(current).length === Object.keys(next).length &&
        Object.entries(next).every(([id, height]) => current[id] === height)
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    contents.forEach((content) => observer.observe(content));
    return () => observer.disconnect();
  });
  return heights;
}
