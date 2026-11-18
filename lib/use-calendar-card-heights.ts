"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export function useCalendarCardHeights(
  scroller: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  scale = 1,
) {
  const [heights, setHeights] = useState<{
    cards: Record<string, number>;
    vehicles: Record<string, number>;
  }>({ cards: {}, vehicles: {} });
  useLayoutEffect(() => {
    if (!enabled || !scroller.current) return;
    const contents = Array.from(
      scroller.current.querySelectorAll<HTMLElement>("[data-calendar-card-order]"),
    );
    const vehicles = Array.from(
      scroller.current.querySelectorAll<HTMLElement>("[data-calendar-vehicle-content]"),
    );
    const measure = () => {
      const nextCards: Record<string, number> = {};
      for (const content of contents) {
        const orderId = content.dataset.calendarCardOrder;
        if (!orderId) continue;
        const contentHeight = content.getBoundingClientRect().height;
        nextCards[orderId] = Math.max(
          nextCards[orderId] ?? 56,
          Math.ceil(contentHeight / scale) + 10,
        );
      }
      const nextVehicles: Record<string, number> = {};
      for (const content of vehicles) {
        const vehicleId = content.dataset.calendarVehicleContent;
        if (!vehicleId) continue;
        nextVehicles[vehicleId] = Math.max(
          nextVehicles[vehicleId] ?? 0,
          Math.ceil(content.getBoundingClientRect().height / scale) + 17,
        );
      }
      setHeights((current) =>
        Object.keys(current.cards).length === Object.keys(nextCards).length &&
        Object.entries(nextCards).every(([id, height]) => current.cards[id] === height) &&
        Object.keys(current.vehicles).length === Object.keys(nextVehicles).length &&
        Object.entries(nextVehicles).every(([id, height]) => current.vehicles[id] === height)
          ? current
          : { cards: nextCards, vehicles: nextVehicles },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    contents.forEach((content) => observer.observe(content));
    vehicles.forEach((content) => observer.observe(content));
    return () => observer.disconnect();
  });
  return heights;
}
