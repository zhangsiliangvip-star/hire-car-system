"use client";

import { useEffect, useRef, useState } from "react";
import type { rankSourcesByUsage } from "@/lib/source-selection";

type Props = {
  sources: ReturnType<typeof rankSourcesByUsage>;
  selected: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  allLabel?: string;
  unassignedValue?: string;
  unassignedLabel?: string;
};

export function getSourceDisplayName(source: { companyName: string; shortName?: string }) {
  return source.shortName?.trim() || source.companyName;
}

export function SourceSelectionDialog({
  sources,
  selected,
  onSelect,
  onClose,
  allLabel,
  unassignedValue,
  unassignedLabel,
}: Props) {
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const keyword = search.trim().toLocaleLowerCase();
  const matches = sources.filter((source) =>
    source.companyName.toLocaleLowerCase().includes(keyword) ||
    (source.shortName || "").toLocaleLowerCase().includes(keyword));
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
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="source-selection-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="dialog-floating-header mb-3 flex items-center justify-between gap-3">
          <h2 id="source-selection-title" className="text-xl font-bold">来源选择</h2>
          <button type="button" onClick={onClose} aria-label="关闭来源选择" className="rounded px-3 py-1 text-2xl text-gray-500">×</button>
        </div>
        <p className="mb-4 text-sm text-gray-500">按訂単数由多到少排列，常用来源在左上角；取消訂単不计入，同訂単数按名称排序。</p>
        <input aria-label="搜索来源" placeholder="搜索来源简称" value={search}
          onChange={(event) => setSearch(event.target.value)} className="mb-4 w-full rounded border p-3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {matches.map((source) => (
            <button key={source.id} type="button" aria-pressed={selected === source.companyName}
              onClick={() => onSelect(source.companyName)}
              className={`min-h-20 break-words rounded-lg border p-3 text-left hover:border-blue-500 hover:bg-blue-50 ${selected === source.companyName ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}>
              <span className="flex items-center gap-2 font-semibold">
                {source.color && (
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: source.color }} />
                )}
                {getSourceDisplayName(source)}
              </span>
              <span className="mt-1 block text-xs text-gray-500">訂単 {source.orderCount} 笔</span>
            </button>
          ))}
        </div>
        {matches.length === 0 && <p className="py-5 text-center text-sm text-gray-500">暂无匹配来源，可在下方手动输入。</p>}
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
          <input aria-label="手动输入来源" placeholder="手动输入新来源" maxLength={200} value={manualName}
            onChange={(event) => setManualName(event.target.value)} className="min-w-0 flex-1 rounded border p-2" />
          <button type="button" disabled={!manualName.trim()} onClick={() => onSelect(manualName.trim())}
            className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-40">选择</button>
        </div>
        <div className="mt-5 flex justify-between gap-3">
          {allLabel ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => onSelect("")} className="rounded border px-4 py-2">{allLabel}</button>
              {unassignedLabel && unassignedValue && (
                <button type="button" onClick={() => onSelect(unassignedValue)} className="rounded border px-4 py-2">{unassignedLabel}</button>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => onSelect("")} className="rounded border px-4 py-2">不填写来源</button>
          )}
        </div>
      </section>
    </div>
  );
}
