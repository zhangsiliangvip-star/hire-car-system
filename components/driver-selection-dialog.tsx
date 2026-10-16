"use client";

import { useEffect, useRef, useState } from "react";
import type { rankDriversByRecentService } from "@/lib/driver-selection";

type Props = {
  drivers: ReturnType<typeof rankDriversByRecentService>;
  selected: string;
  onSelect: (name: string, manual: boolean) => void;
  onClose: () => void;
};

export function DriverSelectionDialog({ drivers, selected, onSelect, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const matches = drivers.filter((driver) => driver.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="driver-selection-title" className="text-xl font-bold">司机选任</h2>
          <button type="button" onClick={onClose} aria-label="关闭司机选任" className="rounded px-3 py-1 text-2xl text-gray-500">×</button>
        </div>
        <p className="mb-4 text-sm text-gray-500">最近30天服务日数由高到低排列，常出勤司机在左上角；同一天多单计1天，同日数按姓名排序。</p>
        <p className="mb-4 text-xs text-gray-500">按预约服务日期统计，优先采用每日财务记录中的司机；排除休运日、取消订单及未来日期，不作为考勤证明。</p>
        <input aria-label="搜索司机" placeholder="搜索司机姓名" value={search}
          onChange={(event) => setSearch(event.target.value)} className="mb-4 w-full rounded border p-3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {matches.map((driver) => (
            <button key={driver.id} type="button" aria-pressed={selected === driver.name}
              onClick={() => onSelect(driver.name, false)}
              className={`min-h-20 break-words rounded-lg border p-3 text-left hover:border-blue-500 hover:bg-blue-50 ${selected === driver.name ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}>
              <span className="block font-semibold">{driver.name}</span>
              <span className="mt-1 block text-xs text-gray-500">最近30天 · {driver.serviceDays}天</span>
            </button>
          ))}
        </div>
        {matches.length === 0 && <p className="py-5 text-center text-sm text-gray-500">暂无匹配司机，可在下方手动输入。</p>}
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
          <input aria-label="手动输入司机姓名" placeholder="手动输入新司机" maxLength={120} value={manualName}
            onChange={(event) => setManualName(event.target.value)} className="min-w-0 flex-1 rounded border p-2" />
          <button type="button" disabled={!manualName.trim()} onClick={() => onSelect(manualName.trim(), true)}
            className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-40">选任</button>
        </div>
        <div className="mt-5 flex justify-between gap-3">
          <button type="button" onClick={() => onSelect("", false)} className="rounded border px-4 py-2">未安排司机</button>
          <button type="button" onClick={onClose} className="rounded border px-4 py-2">取消</button>
        </div>
      </section>
    </div>
  );
}
