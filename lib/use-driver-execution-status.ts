"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { executionStatusDataSchema, type ExecutionStatusData } from "@/lib/driver/execution-status";
import { japanDate } from "@/lib/driver/orders";

export function useDriverExecutionStatus(enabled: boolean) {
  const [data, setData] = useState<ExecutionStatusData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/driver-execution-status", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Driver status read failed.");
        const result = executionStatusDataSchema.parse(await response.json());
        if (!active || request.signal.aborted || document.visibilityState !== "visible") return;
        if (result.date !== japanDate() || result.rows.some(row => row.date !== result.date) ||
          new Set(result.rows.map(row => row.orderId)).size !== result.rows.length) throw new Error("Invalid daily status projection.");
        setData(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result);
        setError("");
        if (result.enabled) timer = setTimeout(() => void load(), 3000);
      } catch (cause) {
        if (!active || request.signal.aborted) return;
        console.error("Driver status refresh failed.", cause instanceof Error ? cause.name : "UnknownError");
        setData(null);
        setError("司机实時状態暂時不可用，正在重试；预约卡片仍保留。");
        timer = setTimeout(() => void load(), 3000);
      }
    }
    function clear() { controller?.abort(); clearTimeout(timer); setData(null); setError(""); }
    function visibility() { clear(); if (active && document.visibilityState === "visible") void load(); }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", visibility);
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { active = false; clear(); }
    });
    if (document.visibilityState === "visible") void load();
    return () => {
      active = false; clear();
      subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", visibility);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      const tomorrow = new Date(`${japanDate(1)}T00:00:00+09:00`).getTime();
      timer = setTimeout(() => { setData(null); schedule(); }, Math.max(1, tomorrow - Date.now()));
    }
    schedule();
    return () => clearTimeout(timer);
  }, [enabled]);
  return { data: enabled ? data : null, error: enabled ? error : "" };
}
