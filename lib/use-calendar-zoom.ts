"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useCalendarZoom(enabled: boolean) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pinching, setPinching] = useState(false);
  const scaleRef = useRef(1);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    if (pendingScroll.current) {
      element.scrollTo({
        left: pendingScroll.current.left,
        top: pendingScroll.current.top,
        behavior: "instant",
      });
      pendingScroll.current = null;
    }
  });

  useEffect(() => {
    if (!enabled || !element) return;
    let gesture: {
      distance: number;
      scale: number;
      contentX: number;
      contentY: number;
    } | null = null;
    let suppressClick = false;
    const position = (touches: TouchList) => {
      const bounds = element.getBoundingClientRect();
      return {
        distance: Math.hypot(
          touches[0].clientX - touches[1].clientX,
          touches[0].clientY - touches[1].clientY,
        ),
        x: (touches[0].clientX + touches[1].clientX) / 2 - bounds.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - bounds.top,
      };
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length === 1) suppressClick = false;
      if (event.touches.length !== 2) return;
      const point = position(event.touches);
      if (!point.distance) return;
      event.preventDefault();
      suppressClick = true;
      gesture = {
        distance: point.distance,
        scale: scaleRef.current,
        contentX: (element.scrollLeft + point.x) / scaleRef.current,
        contentY: (element.scrollTop + point.y) / scaleRef.current,
      };
      setPinching(true);
    };
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 2) return;
      event.preventDefault();
      const point = position(event.touches);
      const nextScale = Math.min(5, Math.max(
        0.25, gesture.scale * point.distance / gesture.distance,
      ));
      pendingScroll.current = {
        left: gesture.contentX * nextScale - point.x,
        top: gesture.contentY * nextScale - point.y,
      };
      scaleRef.current = nextScale;
      setScale(nextScale);
    };
    const end = () => {
      gesture = null;
      setPinching(false);
    };
    const preventNativeGesture = (event: Event) => event.preventDefault();
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    element.addEventListener("gesturestart", preventNativeGesture, { passive: false });
    element.addEventListener("gesturechange", preventNativeGesture, { passive: false });
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
      element.removeEventListener("gesturestart", preventNativeGesture);
      element.removeEventListener("gesturechange", preventNativeGesture);
      element.removeEventListener("click", click, true);
    };
  }, [enabled, element]);

  return { ref: setElement, scale: enabled ? scale : 1, pinching };
}
