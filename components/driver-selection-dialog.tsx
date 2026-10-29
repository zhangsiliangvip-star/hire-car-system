"use client";

import { useEffect, useRef, useState } from "react";
import { shiftStatusSchema } from "@/lib/driver/shifts";

type Props = {
  drivers: { id: string; name: string; serviceDays: number }[];
  selected: string;
  onSelect: (name: string, manual: boolean) => void;
  onClose: () => void;
  allowManual?: boolean;
  emptyLabel?: string;
  showServiceDays?: boolean;
  serviceDates?: string[];
};

export function DriverSelectionDialog({
  drivers,
  selected,
  onSelect,
  onClose,
  allowManual = true,
  emptyLabel = "未安排運転士",
  showServiceDays = true,
  serviceDates = [],
}: Props) {
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const [restDays, setRestDays] = useState<{ key: string; days: { driverId: string; date: string }[] } | null>(null);
  const [restError, setRestError] = useState("");
  const [restRevision, setRestRevision] = useState(0);
  const datesKey = JSON.stringify([...new Set(serviceDates)].sort());
  useEffect(() => {
    const dates: string[] = JSON.parse(datesKey);
    if (!dates.length) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/driver-shifts/status", { method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dates }), signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "休息提示读取失败。");
        const parsed = shiftStatusSchema.parse(result);
        setRestDays({ key: datesKey, days: parsed.days }); setRestError("");
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver rest indicator load failed.", cause);
        setRestDays(null); setRestError(cause instanceof Error ? cause.message : "休息提示读取失败，不能据此判断運転士可出勤。");
      }
    }
    void load();
    return () => controller.abort();
  }, [datesKey, restRevision]);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const matches = drivers.filter((driver) => driver.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        if (event.key === "Tab") {
          const elements = dialogRef.current?.querySelectorAll<HTMLElement>("button, input");
          if (!elements?.length) return;
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="driver-selection-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="dialog-floating-header mb-3 flex items-center justify-between gap-3">
          <h2 id="driver-selection-title" className="text-xl font-bold">運転士選任</h2>
          <button type="button" onClick={onClose} aria-label="关闭運転士選任" className="rounded px-3 py-1 text-2xl text-gray-500">×</button>
        </div>
        {showServiceDays && (
          <>
            <p className="mb-4 text-sm text-gray-500">最近30天服务日数由高到低排列，常出勤運転士在左上角；同一天多单计1天，同日数按姓名排序。</p>
            <p className="mb-4 text-xs text-gray-500">按预约服务日期统计，优先采用每日财务记录中的運転士；排除休运日、取消訂単及未来日期，不作为考勤证明。</p>
          </>
        )}
        <input aria-label="搜索運転士" placeholder="搜索運転士姓名" value={search}
          onChange={(event) => setSearch(event.target.value)} className="mb-4 w-full rounded border p-3" />
        {serviceDates.length > 0 && restError && <p role="alert" className="mb-3 text-sm text-red-600">
          {restError} <button type="button" className="underline" onClick={() => setRestRevision(value => value + 1)}>重试休息提示</button>
        </p>}
        {serviceDates.length > 0 && !restError && restDays?.key !== datesKey &&
          <p role="status" className="mb-3 text-sm text-gray-500">正在读取休息提示…</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {matches.map((driver) => {
            const resting = restDays?.key === datesKey ? restDays.days.filter(day => day.driverId === driver.id) : [];
            return (
            <button key={driver.id} type="button" aria-pressed={selected === driver.name}
              onClick={() => onSelect(driver.name, false)}
              className={`relative min-h-20 break-words rounded-lg border p-3 pr-9 text-left hover:border-blue-500 hover:bg-blue-50 ${selected === driver.name ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}>
              <span className="block font-semibold">{driver.name}</span>
              {showServiceDays && (
                <span className="mt-1 block text-xs text-gray-500">最近30天 · {driver.serviceDays}天</span>
              )}
              {resting.length > 0 && <span className="absolute bottom-2 right-2 text-sm font-bold text-red-600"
                aria-label={`希望休：${resting.map(day => day.date).join("、")}`}
                title={`希望休：${resting.map(day => day.date).join("、")}（仅提示，仍可選任）`}>休</span>}
            </button>
          ); })}
        </div>
        {matches.length === 0 && <p className="py-5 text-center text-sm text-gray-500">{allowManual ? "暂无匹配運転士，可在下方手動输入。" : "暂无匹配運転士。"}</p>}
        {allowManual && (
          <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
            <input aria-label="手動输入運転士姓名" placeholder="手動输入新運転士" maxLength={120} value={manualName}
              onChange={(event) => setManualName(event.target.value)} className="min-w-0 flex-1 rounded border p-2" />
            <button type="button" disabled={!manualName.trim()} onClick={() => onSelect(manualName.trim(), true)}
              className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-40">選任</button>
          </div>
        )}
        <div className="mt-5 flex justify-between gap-3">
          <button type="button" onClick={() => onSelect("", false)} className="rounded border px-4 py-2">{emptyLabel}</button>
        </div>
      </section>
    </div>
  );
}
