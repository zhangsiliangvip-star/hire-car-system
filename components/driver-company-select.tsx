"use client";

import { useEffect, useRef, useState } from "react";

type Props = { value: string; companies: string[]; onChange: (value: string) => void };

function CompanyDialog({ value, companies, onChange, onClose }: Props & { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState("");
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLElement>("#driver-company-title")?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  function choose(name: string) { onChange(name); onClose(); }
  const names = [...new Set(companies.map(name => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ja"))
    .filter(name => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      if (event.key === "Tab") {
        const elements = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input");
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="driver-company-title"
      className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="dialog-floating-header mb-4 flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold tracking-widest text-blue-600">DRIVER COMPANY</p>
          <h2 id="driver-company-title" tabIndex={-1} className="mt-1 text-xl font-bold text-slate-900 outline-none">所属会社を選択</h2></div>
        <button type="button" aria-label="关闭所属会社選択" onClick={onClose} className="rounded-lg px-3 py-1 text-2xl text-slate-500">×</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">显示该運転士地域的会社。選択后自动返回资料编辑，保存资料后生效。</p>
      <input type="search" name="driver-company-filter" aria-label="搜索所属会社" autoComplete="off" placeholder="搜索会社名称" value={search}
        onChange={event => setSearch(event.target.value)} className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 p-3" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {names.map(name => <button key={name} type="button" aria-pressed={name === value} onClick={() => choose(name)}
          className={`min-h-20 break-words rounded-xl border p-4 text-left font-semibold transition-colors hover:border-blue-400 hover:bg-blue-50 ${name === value ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-800"}`}>
          <span className="mb-1 block text-xs font-normal text-blue-600">{name === value ? "選択中" : "会社"}</span>{name}
        </button>)}
      </div>
      {!names.length && <p role="status" className="py-6 text-center text-sm text-slate-500">暂无匹配会社，可手动输入；生成請求書前需在会社管理中登记。</p>}
      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <input aria-label="手动输入所属会社" autoComplete="off" maxLength={200} value={manual} placeholder="手动输入会社名称"
          onChange={event => setManual(event.target.value)} className="min-w-0 flex-1 rounded-lg border p-2" />
        <button type="button" disabled={!manual.trim()} onClick={() => choose(manual.trim())}
          className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-40">選択</button>
      </div>
      <button type="button" onClick={() => choose("")} className="mt-4 rounded-lg border px-4 py-2 text-sm text-slate-600">所属会社を未設定にする</button>
    </section>
  </div>;
}

export function DriverCompanySelect(props: Props) {
  const [open, setOpen] = useState(false);
  return <div className="driver-editor-field driver-editor-full">
    <span className="block">所属会社</span>
    <button type="button" aria-label={`所属会社：${props.value || "未設定"}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)} className="mt-1 flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-blue-400 hover:bg-blue-50">
      <span className="min-w-0 break-words">{props.value || "所属会社を選択"}</span>
      <span className="shrink-0 text-sm font-semibold text-blue-700">選択</span>
    </button>
    {open && <CompanyDialog {...props} onClose={() => setOpen(false)} />}
  </div>;
}
