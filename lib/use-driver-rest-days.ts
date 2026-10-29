"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { shiftStatusSchema } from "@/lib/driver/shifts";

type RestDay = { driverId: string; date: string };

export function useDriverRestDays(enabled: boolean, dates: string[]) {
  const [state, setState] = useState<{ key: string; days: RestDay[] } | null>(null);
  const datesKey = JSON.stringify([...new Set(dates)].sort());
  useEffect(() => {
    const requested: string[] = JSON.parse(datesKey);
    if (!enabled || !requested.length) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      controller?.abort();
      clearTimeout(timer);
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/driver-shifts/status", {
          method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dates: requested }), signal: request.signal,
        });
        if (!response.ok) throw new Error("Driver rest days read failed.");
        const result = shiftStatusSchema.parse(await response.json());
        if (!active || request.signal.aborted) return;
        const allowed = new Set(requested);
        const days = result.days.filter(day => allowed.has(day.date));
        setState(previous => previous?.key === datesKey && JSON.stringify(previous.days) === JSON.stringify(days)
          ? previous : { key: datesKey, days });
      } catch (cause) {
        if (!active || request.signal.aborted) return;
        console.error("Driver rest days refresh failed.", cause instanceof Error ? cause.name : "UnknownError");
      }
      if (active) timer = setTimeout(() => void load(), 60_000);
    }
    function visibility() { if (active && document.visibilityState === "visible") void load(); }
    document.addEventListener("visibilitychange", visibility);
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { active = false; controller?.abort(); clearTimeout(timer); setState(null); }
    });
    void load();
    return () => {
      active = false; controller?.abort(); clearTimeout(timer);
      subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, datesKey]);
  return enabled && state?.key === datesKey ? state.days : [];
}
