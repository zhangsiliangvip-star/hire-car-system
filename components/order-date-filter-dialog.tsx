"use client";

import { useEffect, useRef } from "react";

type Props = {
  month: string;
  selected: string;
  onSelect: (date: string) => void;
  onClose: () => void;
};

export function OrderDateFilterDialog({ month, selected, onSelect, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return (
    <dialog ref={dialogRef} aria-labelledby="order-date-filter-title"
      onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border-0 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50">
      <section className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="order-date-filter-title" className="text-lg font-bold">{month} · 选择日期</h2>
          <button type="button" onClick={onClose} aria-label="关闭日期筛选"
            className="rounded px-3 py-1 text-2xl text-gray-500">×</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
            <span key={day} className="py-2 text-sm text-gray-500">{day}</span>
          ))}
          {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
          {Array.from({ length: dayCount }, (_, index) => {
            const day = index + 1;
            const date = `${month}-${String(day).padStart(2, "0")}`;
            return (
              <button key={date} type="button" aria-label={date} aria-pressed={selected === date}
                onClick={() => onSelect(date)}
                className={`min-h-11 rounded border text-sm hover:border-blue-500 ${selected === date ? "border-blue-700 bg-blue-700 text-white" : "border-gray-200 hover:bg-blue-50"}`}>
                {day}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-between gap-3">
          <button type="button" onClick={() => onSelect("")} className="rounded border px-4 py-2">全部日期</button>
          <button type="button" onClick={onClose} className="rounded border px-4 py-2">取消</button>
        </div>
      </section>
    </dialog>
  );
}
